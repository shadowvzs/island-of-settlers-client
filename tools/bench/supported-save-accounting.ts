import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { MILITARY_RECRUIT_COSTS } from "../../src/shared/balance/military";
import { nationDrinkChain } from "../../src/shared/settlement/nation-drinks";
import { getBuildingProductionRule } from "../../src/shared/settlement/production-rules";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import type { Goods, SettlementActor } from "../../src/shared/settlement/settlement-types";
import { resourcesPath } from "./resources-path";

const base = resourcesPath("project-reviews", "acceptance-2026-10-28");
const output = resolve(process.env.OUT ?? resolve(base, "supported-save-accounting"));
await mkdir(output, { recursive: true });
const audit = JSON.parse(await readFile(resolve(base, "supplied-save-audit/audit.json"), "utf8"));
const labels = ["island-settlers-2026-10-20 (1).json", "island-settlers-2026-10-20.json",
  "settlers-reproduction-808358932-1792487891677.json::baseline",
  "settlers-reproduction-808358932-1792488035479.json::baseline"];
const selected = audit.reports.filter((entry: any) => entry.validated && labels.includes(entry.label));
assert.equal(selected.length, 4);
const add = (goods: Goods, ware: string, units: number) => { goods[ware] = (goods[ware] ?? 0) + units; };
const addGoods = (goods: Goods, incoming?: Readonly<Goods>, sign = 1) => {
  for (const [ware, units] of Object.entries(incoming ?? {})) add(goods, ware, units * sign);
};
const actorGoods = (goods: Goods, actor: SettlementActor) => {
  const committed = actor.productionSeconds !== undefined || actor.boatWork !== undefined;
  if (committed) addGoods(goods, actor.consumed);
  if (actor.ware && actor.phase !== "wellBucketPickup" && !(committed && actor.consumed?.[actor.ware]))
    add(goods, actor.ware, actor.wareUnits ?? 1);
  if (!actor.ware && actor.delivery && !actor.delivery.reserved)
    add(goods, actor.delivery.ware, actor.wareUnits ?? 1);
  if (actor.tool) add(goods, actor.tool, 1);
  addGoods(goods, actor.demolitionCargo);
  if (actor.job === "Mount" && actor.phase !== "retired") add(goods, "horse", 1);
  if (actor.handcart) add(goods, "@handcart", 1);
};
/** Independent census: incoming promises/visual loading manifests are not physical island stock. */
const holdings = (state: SettlementSaveV1) => {
  const goods: Goods = {};
  for (const building of state.buildings) {
    for (const stock of [building.inventory, building.input, building.output, building.shipReserve]) addGoods(goods, stock);
    add(goods, "@handcart", building.handcarts ?? 0);
  }
  for (const actor of state.actors) actorGoods(goods, actor);
  for (const soldier of state.military?.soldiers ?? [])
    if (soldier.combat?.type === "shield" && state.actors.some(actor => actor.uid === soldier.actor)) add(goods, "shield", 1);
  for (const escrow of state.trade?.escrow ?? []) {
    addGoods(goods, escrow.staged);
    for (const row of escrow.held) addGoods(goods, row.goods);
  }
  for (const ship of state.naval.fleet.ships) if (!ship.visitor && ship.phase !== "loading") addGoods(goods, ship.cargo);
  return goods;
};
const difference = (after: Readonly<Goods>, before: Readonly<Goods>) => {
  const result: Goods = {};
  for (const ware of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const change = (after[ware] ?? 0) - (before[ware] ?? 0);
    if (change) result[ware] = change;
  }
  return result;
};
const phaseReceipts = (before: SettlementSaveV1, after: SettlementSaveV1, net: Goods) => {
  const receipts: unknown[] = [];
  for (const actor of before.actors) {
    const next = after.actors.find(next => next.uid === actor.uid);
    if (actor.phase === "pigFeedPutdown" && actor.ware && actor.consumed?.[actor.ware] &&
      next && !(next.consumed?.[actor.ware] ?? 0)) {
      add(net, actor.ware, -actor.consumed[actor.ware]!);
      receipts.push({ kind: "pig-feed-consumed", actor: actor.uid, building: actor.building,
        ware: actor.ware, units: actor.consumed[actor.ware] });
    }
  }
  for (const soldier of before.military?.soldiers ?? []) {
    const next = after.military?.soldiers.find(next => next.actor === soldier.actor);
    if (!next || next.rank <= soldier.rank) continue;
    const units = next.rank - soldier.rank, drink = nationDrinkChain(after.playerNation ?? "roman").drink;
    add(net, "coins", -units);
    if (!(soldier.combat?.faction ?? 0)) add(net, drink, -units);
    receipts.push({ kind: "military-promotion", actor: soldier.actor, units,
      drink: !(soldier.combat?.faction ?? 0) ? drink : undefined });
  }
  for (const delivery of before.trade?.deliveries ?? []) {
    if (delivery.kind === "refund") continue;
    const next = after.trade?.deliveries.find(next => next.id === delivery.id);
    for (const [ware, units] of Object.entries(delivery.goods)) {
      const imported = units - (next?.goods[ware] ?? 0);
      if (imported > 0) { add(net, ware, imported); receipts.push({ kind: "trade-import-at-harbour", id: delivery.id, ware, units: imported }); }
    }
  }
  for (const escrow of before.trade?.escrow ?? []) {
    const next = after.trade?.escrow.find(next => next.id === escrow.id);
    for (const [ware, units] of Object.entries(escrow.goods)) {
      const exported = units - (next?.goods[ware] ?? 0);
      if (exported > 0) { add(net, ware, -exported); receipts.push({ kind: "trade-export-loaded", id: escrow.id, ware, units: exported }); }
    }
  }
  return receipts;
};
const reports = [];
const serviceReceipts = (before: SettlementSaveV1, after: SettlementSaveV1, net: Goods) => {
  const receipts: unknown[] = [];
  for (const actor of before.actors) {
    if (after.actors.some(next => next.uid === actor.uid)) continue;
    const soldier = before.military?.soldiers.find(soldier => soldier.actor === actor.uid);
    if (soldier) {
      const gear: Goods = actor.tool ? { [actor.tool]: 1 } : {};
      if (soldier.combat?.type === "shield") gear.shield = 1;
      addGoods(net, gear, -1);
      receipts.push({ kind: "withdrawn-or-dead-troop-equipment", actor: actor.uid, gear });
    } else if (actor.job === "Mount") {
      add(net, "horse", -1);
      receipts.push({ kind: "legacy-idle-horse-retirement", actor: actor.uid });
    }
  }
  for (const soldier of after.military?.soldiers ?? []) {
    if (before.military?.soldiers.some(old => old.actor === soldier.actor)) continue;
    const type = soldier.combat?.type ?? "shield";
    if (type === "cavalry") continue;
    const cost = MILITARY_RECRUIT_COSTS[type], consumed: Goods = {};
    for (const [ware, count] of Object.entries(cost)) if (ware === "beer" || ware === "coins") consumed[ware] = count;
    if (soldier.combat?.faction) consumed.coins = soldier.rank;
    addGoods(net, consumed, -1);
    receipts.push({ kind: "troop-equipped-consumables", actor: soldier.actor, type, consumed });
  }
  return receipts;
};
const recipesHasBuilding = (recipes: Map<string, { building: number }>, uid: number) =>
  [...recipes.values()].some(recipe => recipe.building === uid);
for (const [index, entry] of selected.entries()) {
  if (process.env.ACCOUNT_CASE !== undefined && Number(process.env.ACCOUNT_CASE) !== index) continue;
  const bytes = await readFile(entry.copy), hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash, entry.sourceHash);
  const original = JSON.parse(bytes.toString("utf8")), source = entry.label.endsWith("::baseline") ? original.baseline : original;
  const recipes = new Map<string, { building: number; type: number; cycles: number; consumed: Goods; produced: Goods }>();
  const net: Goods = {}, flows: unknown[] = [], residuals: unknown[] = [], journeys = new Map<number, Set<string>>();
  const transitions = new Map<string, { count: number; examples: unknown[] }>();
  const actorContact = (actor: SettlementActor, state: SettlementSaveV1) => {
    const building = state.buildings.find(building => building.uid === actor.building);
    return { uid: actor.uid, phase: actor.phase, position: { x: actor.x, z: actor.z },
      building: actor.building, home: actor.home, target: actor.target, preparedTarget: actor.preparedTarget,
      pathIndex: actor.pathIndex, pathLength: actor.path.length, nextPathPoint: actor.path[actor.pathIndex],
      timer: actor.timer, queueKind: actor.queueKind, stockContact: actor.stockContact,
      access: building?.access, doorThreshold: building?.doorThreshold };
  };
  let midpoint: unknown;
  let tick = 0;
  const observer: NonNullable<Parameters<typeof createHeadlessIsland>[3]>["onProductionCycle"] = (building, consumed, output) => {
    const inputs = structuredClone(consumed), product: Goods = output ? { [output]: 1 } : {};
    if (building.handcartMode && building.typeId === 33 && !output) product["@handcart"] = 1;
    const key = JSON.stringify([building.uid, building.typeId, inputs, product]);
    const recipe = recipes.get(key) ?? { building: building.uid, type: building.typeId, cycles: 0, consumed: {}, produced: {} };
    recipe.cycles++; addGoods(recipe.consumed, inputs); addGoods(recipe.produced, product); recipes.set(key, recipe);
    addGoods(net, inputs, -1); addGoods(net, product);
  };
  let current = await createHeadlessIsland(source, false, false, { onProductionCycle: observer });
  let before = current.simulation.saveState();
  const opening = holdings(before), seconds = Number(process.env.ACCOUNT_SECONDS ?? 600);
  for (; tick < seconds * 20; tick++) {
    const oldHoldings = holdings(before), oldNet = { ...net };
    current.simulation.update(.05);
    const after = current.simulation.saveState();
    for (const actor of after.actors) {
      const phases = journeys.get(actor.uid) ?? new Set(); phases.add(actor.phase); journeys.set(actor.uid, phases);
      const old = before.actors.find(old => old.uid === actor.uid);
      if (old && (old.phase !== actor.phase || old.target?.id !== actor.target?.id ||
        old.target?.kind !== actor.target?.kind || old.queueKind !== actor.queueKind)) {
        const key = JSON.stringify([old.phase, actor.phase, old.target?.kind, actor.target?.kind,
          old.queueKind, actor.queueKind]);
        const transition = transitions.get(key) ?? { count: 0, examples: [] };
        transition.count++;
        if (transition.examples.length < 3) transition.examples.push({ tick,
          before: actorContact(old, before), after: actorContact(actor, after) });
        transitions.set(key, transition);
      }
    }
    const observedFlows = [...phaseReceipts(before, after, net), ...serviceReceipts(before, after, net)];
    for (const flow of observedFlows) flows.push({ tick, ...(flow as object) });
    const actual = difference(holdings(after), oldHoldings), expected = difference(net, oldNet);
    const unexplained = difference(actual, expected);
    if (Object.keys(unexplained).length) residuals.push({ tick, unexplained, actual, expected,
      actors: after.actors.filter(actor => {
        const old = before.actors.find(old => old.uid === actor.uid);
        return !old || old.phase !== actor.phase || old.ware !== actor.ware || JSON.stringify(old.consumed) !== JSON.stringify(actor.consumed);
      }).map(actor => ({ uid: actor.uid, phase: actor.phase, ware: actor.ware, consumed: actor.consumed, seconds: actor.productionSeconds })) });
    before = after;
    if ((tick + 1) % 1200 === 0) console.log(JSON.stringify({ index, seconds: (tick + 1) / 20, residuals: residuals.length }));
    if (tick + 1 === seconds * 10) {
      const saved = await current.save();
      current = await createHeadlessIsland(saved, false, false, { onProductionCycle: observer });
      assert.deepEqual(current.simulation.saveState(), before);
      assert.deepEqual(holdings(current.simulation.saveState()), holdings(before));
      midpoint = { tick: tick + 1, exactSettlementRestored: true,
        settlementSHA256: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
        contacts: before.actors.map(actor => actorContact(actor, before)) };
    }
  }
  const final = await current.save();
  await writeFile(resolve(output, `${index}-final.json`), JSON.stringify(final));
  const report = { label: entry.label, sourceSha256: hash, seconds, recipes: [...recipes.values()],
    canonicalRules: before.buildings.filter(building => recipesHasBuilding(recipes, building.uid)).map(building => ({
      uid: building.uid, rule: getBuildingProductionRule(building, before.playerNation)
    })), opening, closing: holdings(before), expectedNet: net, flows,
    residuals, midpoint, transitions: [...transitions].map(([key, value]) => ({ key, ...value })),
    journeys: [...journeys].map(([actor, phases]) => ({ actor, phases: [...phases] })) };
  reports.push(report);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ reports,
    scope: "Independent per-recipe callback receipts and physical custody census on immutable supported originals, exact ticks +midpoint reload",
    allExplained: reports.every(report => !report.residuals.length) }, null, 2));
  assert.equal(createHash("sha256").update(await readFile(entry.copy)).digest("hex"), hash);
  console.log(JSON.stringify({ index, label: entry.label, recipes: recipes.size, residuals: residuals.length }));
}
assert(reports.every(report => !report.residuals.length), "Every physical stock delta needs a recipe or named flow receipt");
