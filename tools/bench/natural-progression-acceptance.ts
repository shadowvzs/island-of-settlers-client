import { STARTER_STOCK } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../../src/render-common/buildings/building-grid-metrics";
import { buildingUnlockLevel } from "../../src/shared/progression/building-unlocks";
import { isMineType, requiredMineOre } from "../../src/shared/settlement/settlement-placement";
import { TREE_TYPES } from "../../src/shared/settlement/settlement-resources";
import { resourceWorkRadius } from "../../src/shared/settlement/settlement-work-ranges";
import { ORE } from "../../src/shared/world/world-data";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const output = resolve(process.env.OUT ?? resourcesPath("project-reviews", "acceptance-2026-10-28", "natural-progression"));
mkdirSync(output, { recursive: true });
const source = process.env.SOURCE;
const session = await createNaturalProgressionSession(source ? JSON.parse(readFileSync(source, "utf8")) : undefined);
const { baseline } = session;
let { player, resourceTargets, save, sim, world } = session;
if (!source) { assert.deepEqual(sim.headquarters.inventory, STARTER_STOCK); assert.equal(player.level(), 1); }
const events: unknown[] = [], snapshots: string[] = [];
let seconds = sim.tickCount() * .05, checkpoint = 0;
const totals = () => Object.fromEntries(Object.keys(STARTER_STOCK).concat(["flax", "cloth", "flour", "meat", "pig"])
  .map(ware => [ware, sim.resourceTotal(ware)]));
const snapshot = async (label: string) => {
  const file = `${String(checkpoint++).padStart(2, "0")}-${label}.json`;
  writeFileSync(resolve(output, file), JSON.stringify(await save()), { flag: "wx" });
  snapshots.push(file);
};
const report = (status: string, reason?: string) => {
  const value = { status, reason, source: source ?? "fresh canonical HQ", secondsScope: source ? "continuation segment" : "fresh segment", seed: world.seed, seconds, level: player.level(),
    experience: player.progress().experience, tutorial: player.tutorialSummary(),
    initialStock: baseline.settlement.buildings[0]!.inventory, stock: totals(), events, snapshots,
    buildings: sim.buildings(), actors: sim.frames(), ships: sim.ships(),
    constraints: { directExperience: false, debugUnlock: false, prebuiltChains: false,
      importedGoods: false, resourceManagers: "canonical live runtime", timestep: .05 } };
  writeFileSync(resolve(output, "report.json"), JSON.stringify(value, null, 2));
};
const place = (typeId: number) => {
  const home = sim.headquarters, footprint = getBuildingDefinition(typeId).gridFootprint;
  let resource: "stone" | "wildlife" | undefined;
  if (typeId === 19) resource = "stone";
  if (typeId === 22) resource = "wildlife";
  const targets = resource ? resourceTargets?.(resource, home, Math.hypot(world.cellsX, world.cellsZ)) ?? [] : [];
  const candidates: Array<{ x: number; z: number; rotation: number; score: number }> = [];
  for (const rotation of [0, 1, 2, 3]) {
  const [width, depth] = rotation % 2 ? [footprint[1]!, footprint[0]!] : footprint;
  const step = 1;
  for (let dz = -Math.floor(home.z); dz <= world.cellsZ - Math.floor(home.z); dz += step)
    for (let dx = -Math.floor(home.x); dx <= world.cellsX - Math.floor(home.x); dx += step) {
    const x = Math.floor(home.x) + dx + (width % 2 ? .5 : 0);
    const z = Math.floor(home.z) + dz + (depth % 2 ? .5 : 0);
    if (Math.hypot(dx, dz) < 6 || sim.validatePlacement(typeId, x, z, rotation)) continue;
    let score = Math.hypot(dx, dz);
    if (resource) {
      const origin = typeId === 19 ? getPlacedBuildingLogistics(typeId, x, z, rotation).road : { x, z };
      const reachableRange = targets.filter(target =>
        Math.hypot(target.x - origin.x, target.z - origin.z) <= resourceWorkRadius(resource));
      if (!reachableRange.length) continue;
      score -= Math.min(12, reachableRange.length) * 2;
    }
    if (typeId === 17) for (let id = 0; id < world.props.count; id++) {
      if (TREE_TYPES.has(world.props.types[id]!) && Math.hypot(world.props.x[id]! - x, world.props.z[id]! - z) < 10) score -= .2;
    }
    if ([20, 37, 60].includes(typeId)) {
      const nearby = sim.buildings().filter(building => [20, 37, 60].includes(building.typeId));
      if (nearby.some(building => Math.hypot(building.x - x, building.z - z) < 12)) continue;
    }
    candidates.push({ x, z, rotation, score });
  }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const point of candidates.slice(0, 500)) {
    const placed = sim.placeBuilding(typeId, point.x, point.z, point.rotation);
    if (!placed.ok || !placed.building) continue;
    if (!sim.connectRoads(home.access, placed.building.access)) {
      sim.demolishBuilding(placed.building.uid); continue;
    }
    if (typeId === 36) sim.setShipyardMode(placed.building.uid, "ships");
    events.push({ kind: "paid-site", seconds, level: player.level(), typeId, uid: placed.building.uid,
      x: point.x, z: point.z, required: { ...placed.building.required }, stock: totals() });
    console.log(`site type${typeId} uid${placed.building.uid} at ${point.x},${point.z}`);
    return true;
  }
  throw new Error(`No naturally legal connected plot for type ${typeId} at level ${player.level()}`);
};
/** The UI's Geologist tool: click reachable mine ground; the canonical command picks the deposit. */
const geologistActive = () => sim.frames().some(actor => actor.job === "Geologist" &&
  ["assigned", "surveyWalk", "surveyWork", "surveyReturnWait"].includes(actor.phase));
const surveyedOre = (ore: number) => world.mineZones.some(zone => zone.surveyed && zone.ore === ore);
const dispatchSurvey = (ore?: number) => {
  const home = sim.headquarters.access, byZone = new Map(world.mineZones.map(zone => [zone.id, zone]));
  const candidates: Array<{ x: number; z: number; zoneId: number; score: number }> = [];
  for (let cell = 0; cell < world.mineZone.length; cell++) {
    const zone = byZone.get(world.mineZone[cell]!);
    if (!zone || zone.surveyed || (ore === undefined ? zone.ore === ORE.none : zone.ore !== ore)) continue;
    const x = cell % world.cellsX + .5, z = Math.floor(cell / world.cellsX) + .5;
    candidates.push({ x, z, zoneId: zone.id, score: Math.hypot(x - home.x, z - home.z) });
  }
  candidates.sort((a, b) => a.score - b.score);
  const seen = new Map<number, number>(), selected: typeof candidates = [];
  for (const point of candidates) {
    const tried = seen.get(point.zoneId) ?? 0;
    if (tried >= 3) continue;
    seen.set(point.zoneId, tried + 1); selected.push(point);
  }
  for (const target of selected) {
    const result = sim.dispatchSurveyJob("Geologist", target);
    if (!result.ok) continue;
    events.push({ kind: "normal-survey-dispatch", seconds, level: player.level(), job: "Geologist",
      zoneId: target.zoneId, ore: byZone.get(target.zoneId)!.ore, x: target.x, z: target.z });
    return true;
  }
  return false;
};
await snapshot(source ? "retained-continuation" : "fresh-hq");
try {
  let active = "", stepSeconds = 0, previousLevel = player.level(), reloadedStep = false;
  let lastProgress = -1, noProgressSeconds = 0;
  while (seconds < 28_800 && !sim.ships().length) {
    const summary = player.tutorialSummary(), quest = summary?.quest;
    if (!quest) throw new Error("No active natural tutorial before first ship");
    if (quest.id !== active) {
      active = quest.id; stepSeconds = 0; reloadedStep = false;
      lastProgress = -1; noProgressSeconds = 0;
      console.log(`${seconds}s level${player.level()} ${active} ${summary.progress}/${quest.objective.amount}`);
    }
    if (summary.ready) {
      const result = await player.completeQuest(quest.id);
      assert.equal(result, true);
      events.push({ kind: "earned-claim", seconds, id: quest.id, level: player.level(), experience: player.progress().experience });
      if (player.level() !== previousLevel) {
        previousLevel = player.level(); await snapshot(`earned-level-${previousLevel}`);
      }
      continue;
    }
    const objective = quest.objective;
    noProgressSeconds = summary.progress === lastProgress ? noProgressSeconds + 10 : 0;
    lastProgress = summary.progress;
    if (summary.skippable) {
      assert.equal(player.skipTutorial(quest.id), true);
      events.push({ kind: "normal-optional-or-absent-resource-skip", id: quest.id, seconds });
      continue;
    }
    if (objective.kind === "event" && objective.event === "survey" && summary.progress < objective.amount) {
      if (!geologistActive() && !dispatchSurvey())
        throw new Error(`No reachable unsurveyed ore deposit for ${quest.id}`);
    }
    if (objective.kind === "build") {
      const count = sim.buildings().filter(building => building.typeId === objective.building).length;
      if (count < objective.amount) {
        const ore = isMineType(objective.building) ? requiredMineOre(objective.building) : undefined;
        if (ore !== undefined && !surveyedOre(ore)) {
          if (!geologistActive() && !dispatchSurvey(ore))
            throw new Error(`No reachable unsurveyed ore ${ore} deposit for mine type ${objective.building}`);
        } else place(objective.building);
      }
    }
    if (quest.id === "talent.apply") assert.equal(player.applyTalents({ productionSpeed: 1 }), true);
    if (objective.kind === "produce" && noProgressSeconds >= 60) {
      const resourceProducers: Record<string, number> = { logs: 17, meat: 22, stone: 19 };
      const producer = resourceProducers[objective.ware];
      const sites = sim.buildings().filter(building => building.typeId === producer);
      const idle = sites.length > 0 && sites.every(building => building.construction === 1 &&
        sim.frames().find(actor => actor.uid === building.worker)?.phase === "workSearchWait");
      if (producer && sites.length < 3 && idle) {
        place(producer);
        events.push({ kind: "normal-extra-resource-camp", seconds, typeId: producer, ware: objective.ware });
        noProgressSeconds = 0;
      }
    }
    for (const [type, ware, low, high] of [[17, "logs", 20, 60], [33, "planks", 50, 120],
      [19, "stone", 30, 80], [18, "fish", 20, 50], [22, "meat", 12, 24], [35, "water", 20, 60],
      [37, "grain", 20, 60], [31, "flour", 10, 30], [32, "bread", 12, 36],
      [60, "flax", 12, 36], [61, "cloth", 8, 24], [28, "pig", 4, 12], [21, "meat", 12, 24],
      [3, "hides", 12, 36], [8, "leather", 12, 36], [5, "grapes", 12, 36], [6, "wine", 8, 24]] as const) {
      const amount = sim.resourceTotal(ware);
      for (const building of sim.buildings().filter(building => building.typeId === type)) {
        let paused = !!building.productionPaused;
        if (objective.kind === "produce" && objective.ware === ware) paused = false;
        else if (amount >= high) paused = true;
        else if (amount <= low) paused = false;
        if (paused !== !!building.productionPaused && sim.setProductionPaused(building.uid, paused))
          events.push({ kind: "normal-production-pause", seconds, uid: building.uid, paused, ware, amount });
      }
    }
    for (let tick = 0; tick < 200; tick++) sim.update(.05);
    seconds += 10; stepSeconds += 10;
    if (stepSeconds % 300 === 0) {
      console.log(`  ${seconds}s ${active} ${player.tutorialSummary()?.progress}/${objective.amount} ${JSON.stringify(totals())}`);
      report("running");
    }
    if (process.env.NO_RELOAD !== "1" && stepSeconds >= 1200 && !reloadedStep) {
      await snapshot(`before-reload-${active.replaceAll(".", "-")}`);
      const restored = await createNaturalProgressionSession(await save());
      ({ player, resourceTargets, save, sim, world } = restored);
      reloadedStep = true;
      events.push({ kind: "actual-runtime-restore", seconds, id: active });
    }
    if (stepSeconds >= Number(process.env.STEP_SECONDS ?? 7200)) throw new Error(`Natural tutorial did not complete within bounded step horizon at ${active}`);
  }
  assert(sim.ships().length > 0, "No naturally paid first ship within bounded horizon");
  assert(player.level() >= buildingUnlockLevel(36), "Current Shipyard unlock must be earned");
  await snapshot("first-natural-ship"); report("passed");
  console.log(`PASS first natural ship at ${seconds}s level${player.level()}`);
} catch (error) {
  await snapshot("bounded-failure"); report("blocked", String(error));
  throw error;
}
