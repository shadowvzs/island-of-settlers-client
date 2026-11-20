import { describe, expect, it } from "vitest";

import type { ScriptEmission } from "../../island-of-settlers-shared/src/script/types/emission";
import type { MapScript, ScriptEvent, ScriptTrigger } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, player1, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { HARBOUR_TYPE_ID, SAWMILL_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { MerchantOffer } from "../src/shared/trade/trade-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

/**
 * EXT-EVENTS: economy events from real simulations. Buildings: upgraded (builder and development tool), ware
 * produced per batch (workshop cycle, well) and "production reached X" on top of it. Trade: a merchant offer
 * bought, an own offer sold to an NPC buyer and the trade ship's delivery arriving at the harbour. Each fires once
 * with its slots and never in catch-up. Construction completed and destroyed/demolished are covered by
 * `script-world-events.test.ts` (TRG3a).
 */

type Slots = ScriptEvent["slots"];

const WELL_TYPE_ID = 35;
const REACHED = 3;

const on = (kind: ScriptEvent["kind"], slots: object = {}, player: ScriptEvent["player"] = { kind: "any" }) =>
  ({ kind, player, slots: slots as Slots }) as ScriptEvent;

const counter = (id: string, event: ScriptEvent): ScriptTrigger => trigger(id, {
  actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", `v-${id}`) })],
  events: [event]
});

const scriptOf = (counters: Record<string, ScriptEvent>): MapScript => emptyScript({
  triggers: Object.entries(counters).map(([id, event]) => counter(id, event)),
  variables: Object.keys(counters).map(id => numberVariable(`v-${id}`, id))
});

const valueOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[`v-${id}`]?.value;

/** Records every emission the engine receives (after the subscription gate). */
const recordEmissions = (sim: SettlementSimulation) => {
  const engine = sim.script()!.engine, emitted: ScriptEmission[] = [];
  const original = engine.emit.bind(engine);
  engine.emit = emission => { if (engine.isSubscribed(emission.kind)) emitted.push(emission); original(emission); };
  return emitted;
};

const ofKind = (emitted: readonly ScriptEmission[], kind: ScriptEmission["kind"]) =>
  emitted.filter(emission => emission.kind === kind);

const ware = (key: string) => ref("content", `ware:${key}`);
const responseOf = (emission: ScriptEmission, key: string) =>
  (emission.responses![key] as { value: number | string }).value;

describe("EXT-EVENTS building upgraded", () => {
  it("fires once per reached level with the level slot, also for the development tool, never in catch-up", () => {
    const script = scriptOf({
      any: on("buildingUpgraded"), levelThree: on("buildingUpgraded", { level: num(3) }),
      levelTwo: on("buildingUpgraded", { level: num(2) }, player1)
    });
    const { advance, building, simulation } = workshopUpgradeFixture(SAWMILL_TYPE_ID,
      { hardwoodLogs: 4, hardwoodPlanks: 4, marble: 2 }, false, script);
    const emitted = recordEmissions(simulation);
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
    advance(600, () => building.workshopUpgrade?.level === 1);
    advance(1);
    const upgraded = ofKind(emitted, "buildingUpgraded");
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]!.actors!.building).toMatchObject({
      handle: { id: building.uid, space: "building" }, owner: 0, qualifiers: { level: 2 }, type: "building:sawmill"
    });
    expect(upgraded[0]!.values).toEqual({ level: 2 });
    expect(responseOf(upgraded[0]!, "amount")).toBe(2);
    expect([valueOf(simulation, "any"), valueOf(simulation, "levelTwo"), valueOf(simulation, "levelThree")])
      .toEqual([1, 1, 0]);
    // Catch-up: the level rises, nothing is emitted and the run state stays as it was.
    simulation.setScriptMode("catchUp");
    const before = simulation.saveState().scriptRun;
    expect(simulation.debugRaiseBuildingLevel(building.uid)).toMatchObject({ level: 3, ok: true });
    advance(1);
    expect(ofKind(emitted, "buildingUpgraded")).toHaveLength(1);
    expect(simulation.saveState().scriptRun).toEqual(before);
    simulation.endScriptCatchUp();
    simulation.setScriptMode("live");
    expect(simulation.debugRaiseBuildingLevel(building.uid)).toMatchObject({ level: 4, ok: true });
    advance(1);
    expect(ofKind(emitted, "buildingUpgraded").map(emission => emission.values!.level)).toEqual([2, 4]);
    expect(valueOf(simulation, "any")).toBe(2);
  }, 240_000);
});

/** "Production reached X": every produced batch adds its amount; the one-shot trigger fires at the threshold. */
const productionScript = (produced: string): MapScript => {
  const script = scriptOf({
    anyWare: on("wareProduced"), other: on("wareProduced", { ware: ware("bread") }),
    produced: on("wareProduced", { ware: ware(produced) }, player1)
  });
  script.variables.push(numberVariable("v-total", "total"), numberVariable("v-reached", "reached"));
  script.triggers.push(
    trigger("total", {
      actions: [doStep("s1", "increaseVariable", { amount: { k: "resp", key: "amount" },
        variable: ref("variable", "v-total") })],
      events: [on("wareProduced", { ware: ware(produced) })]
    }),
    trigger("reached", {
      actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", "v-reached") })],
      conditions: { a: { k: "var", variable: ref("variable", "v-total") }, b: num(REACHED), k: "compare", op: ">=" },
      events: [on("variableChanged", { variable: ref("variable", "v-total") })], runLimit: 1
    }));
  return script;
};

describe("EXT-EVENTS ware produced and production reached X", () => {
  const produce = (type: number, output: string, stock: Record<string, number>) => {
    const { advance, building, simulation } = workshopUpgradeFixture(type, stock, false, productionScript(output));
    const emitted = recordEmissions(simulation);
    const batches = () => ofKind(emitted, "wareProduced");
    return { advance, batches, building, simulation };
  };

  it("a sawmill emits one batch per finished cycle; the threshold trigger fires once; catch-up is silent", () => {
    const { advance, batches, building, simulation } = produce(SAWMILL_TYPE_ID, "planks", { logs: 40 });
    advance(900, () => batches().length >= REACHED + 1);
    advance(1);
    const count = batches().length;
    expect(count).toBeGreaterThanOrEqual(REACHED + 1);
    for (const batch of batches()) {
      expect(batch.actors!.building)
        .toMatchObject({ handle: { id: building.uid }, owner: 0, type: "building:sawmill" });
      expect(batch.values).toEqual({ ware: "planks" });
      expect(responseOf(batch, "ware")).toBe("planks");
      expect(responseOf(batch, "amount")).toBe(1);
    }
    expect([valueOf(simulation, "anyWare"), valueOf(simulation, "produced"), valueOf(simulation, "other")])
      .toEqual([count, count, 0]);
    expect(valueOf(simulation, "total")).toBe(count);
    expect(valueOf(simulation, "reached")).toBe(1);
    // Catch-up: production continues and the island's counter keeps counting, but no event is delivered.
    simulation.setScriptMode("catchUp");
    const counted = () => simulation.saveState().scriptRun!.counters?.["produce:planks"] ?? 0;
    const before = { counted: counted(), cycle: building.cycle ?? 0 };
    advance(600, () => (building.cycle ?? 0) > before.cycle && counted() > before.counted);
    expect(building.cycle).toBeGreaterThan(before.cycle);
    expect(counted()).toBeGreaterThan(before.counted);
    expect(batches()).toHaveLength(count);
    expect(valueOf(simulation, "total")).toBe(count);
  }, 240_000);

  it("a well's bucket is a produced batch of water", () => {
    const { advance, batches, building, simulation } = produce(WELL_TYPE_ID, "water", {});
    advance(900, () => batches().length >= REACHED);
    advance(1);
    expect(batches().length).toBeGreaterThanOrEqual(REACHED);
    expect(batches().length).toBe(building.cycle);
    expect(batches()[0]!.actors!.building!.type).toBe("building:well");
    expect(batches().every(batch => batch.values!.ware === "water" && responseOf(batch, "amount") === 1)).toBe(true);
    expect(valueOf(simulation, "reached")).toBe(1);
  }, 240_000);
});

const SIZE = 64, COAST = 36;
const STOCK = { fish: 40, planks: 200, stone: 100 };

/** Land in the west, open sea from x = 36 to the east map edge (the trade ship's way in). */
const coastWorld = (script: MapScript) => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const data = { blocking: new Uint8Array(SIZE ** 2), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    cellsX: SIZE, cellsZ: SIZE, heights, mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    oreAmount: new Uint8Array(SIZE ** 2), props: { count: 0, scale: new Float32Array(), types: new Uint8Array(),
      x: new Float32Array(), z: new Float32Array() }, script, seaLevel: -1, seed: 4, start: { x: 12.5, z: 12.5 },
    walkCost: new Uint8Array(SIZE ** 2).fill(10)
  } as unknown as WorldData;
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 0; data.blocking[z * SIZE + x] = 1;
  }
  return data;
};

const createIsland = (world: WorldData) => {
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 30,
    initialStock: { ...STOCK }, now: () => 50_000, playerLevel: () => 1, roads, unlockAllBuildings: true, world });
  return simulation;
};

const MARKET: MerchantOffer[] = [
  { give: { amount: 10, ware: "logs" }, id: "m0-0", merchant: "Livia Portus", status: "open",
    want: { amount: 2, ware: "fish" } },
  { give: { amount: 6, ware: "bread" }, id: "m0-1", merchant: "Livia Portus", status: "open",
    want: { amount: 3, ware: "stone" } }
];

const TRADE_EVENTS = {
  arrived: on("tradeDeliveryArrived"),
  arrivedAtHarbour: on("tradeDeliveryArrived",
    { harbour: { kind: "type", type: { type: ref("content", "building:harbour") } } }, player1),
  boughtLogs: on("wareBought", { payment: ware("fish"), ware: ware("logs") }, player1),
  boughtStone: on("wareBought", { ware: ware("stone") }),
  purchaseArrived: on("tradeDeliveryArrived", { trade: str("purchase"), ware: ware("logs") }),
  saleArrived: on("tradeDeliveryArrived", { trade: str("sale") }),
  sold: on("wareSold"),
  soldPlanks: on("wareSold", { payment: ware("fish"), ware: ware("planks") }, player1)
};

/** A home island with a finished, road-connected harbour, today's market replaced by known offers. */
const tradeIsland = () => {
  const world = coastWorld(scriptOf(TRADE_EVENTS)), fresh = createIsland(world);
  const [width, depth] = getBuildingDefinition(HARBOUR_TYPE_ID).gridFootprint;
  const placed = fresh.placeBuilding(HARBOUR_TYPE_ID, Math.floor(32 - width / 2) + width / 2,
    Math.floor(20 - depth / 2) + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  Object.assign(placed.building!, { construction: 1, input: {}, required: {}, worker: undefined });
  expect(fresh.connectRoads(fresh.headquarters.access, placed.building!.access)).toBe(true);
  fresh.update(.05);
  const saved = JSON.parse(JSON.stringify(fresh.saveState()));
  saved.trade.market = { day: 0, level: 1, offers: MARKET };
  const simulation = createIsland(world);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  return { emitted: recordEmissions(simulation), harbourUid: placed.building!.uid, simulation };
};

const run = (simulation: SettlementSimulation, seconds: number, done: () => boolean) => {
  for (let tick = 0; tick < seconds * 20 && !done(); tick++) simulation.update(.05);
  return done();
};

const tradeSettled = (simulation: SettlementSimulation) => !simulation.trade().deliveries.length &&
  !simulation.trade().escrow.length && !simulation.ships().some(ship => ship.visitorRole === "trade");

describe("EXT-EVENTS trade", () => {
  it("a bought offer fires wareBought once and its delivery arrives once at the harbour", () => {
    const { emitted, harbourUid, simulation } = tradeIsland();
    expect(simulation.tradeBuy("m0-9")).not.toBe(true);
    expect(simulation.tradeBuy("m0-0")).toBe(true);
    simulation.update(.05);
    const bought = ofKind(emitted, "wareBought");
    expect(bought).toHaveLength(1);
    expect(bought[0]).toMatchObject({ player: 0, values: { payment: "fish", ware: "logs" } });
    expect([responseOf(bought[0]!, "ware"), responseOf(bought[0]!, "amount")]).toEqual(["logs", 10]);
    expect([valueOf(simulation, "boughtLogs"), valueOf(simulation, "boughtStone")]).toEqual([1, 0]);
    expect(ofKind(emitted, "tradeDeliveryArrived")).toEqual([]);
    expect(run(simulation, 1500, () => tradeSettled(simulation))).toBe(true);
    simulation.update(.05);
    const arrived = ofKind(emitted, "tradeDeliveryArrived");
    expect(arrived).toHaveLength(1);
    expect(arrived[0]!.actors!.harbour).toMatchObject({
      handle: { id: harbourUid, space: "building" }, owner: 0, type: "building:harbour"
    });
    expect(arrived[0]!.values).toEqual({ trade: "purchase", ware: "logs" });
    expect([responseOf(arrived[0]!, "ware"), responseOf(arrived[0]!, "amount")]).toEqual(["logs", 10]);
    expect(arrived[0]!.responses!.building).toEqual(arrived[0]!.actors!.harbour!.handle);
    expect(["arrived", "arrivedAtHarbour", "purchaseArrived", "saleArrived"].map(id => valueOf(simulation, id)))
      .toEqual([1, 1, 1, 0]);
    expect(ofKind(emitted, "wareBought")).toHaveLength(1);
  }, 240_000);

  it("an own offer filled by an NPC buyer fires wareSold once; its payment arrives as a sale delivery", () => {
    const { emitted, simulation } = tradeIsland();
    expect(simulation.tradePlaceOffer({ amount: 30, ware: "planks" }, { amount: 14, ware: "fish" })).toBe(true);
    run(simulation, 30, () => false);
    expect(ofKind(emitted, "wareSold")).toEqual([]);
    expect(simulation.tradeSetNpcTraders(true)).toBe(true);
    expect(run(simulation, 600, () => ofKind(emitted, "wareSold").length > 0)).toBe(true);
    simulation.update(.05);
    const sold = ofKind(emitted, "wareSold");
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ player: 0, values: { payment: "fish", ware: "planks" } });
    expect([responseOf(sold[0]!, "ware"), responseOf(sold[0]!, "amount")]).toEqual(["planks", 30]);
    expect([valueOf(simulation, "sold"), valueOf(simulation, "soldPlanks")]).toEqual([1, 1]);
    expect(run(simulation, 1500, () => tradeSettled(simulation))).toBe(true);
    simulation.update(.05);
    const arrived = ofKind(emitted, "tradeDeliveryArrived");
    expect(arrived.map(emission => emission.values)).toEqual([{ trade: "sale", ware: "fish" }]);
    expect(responseOf(arrived[0]!, "amount")).toBe(14);
    expect(["arrived", "purchaseArrived", "saleArrived", "sold"].map(id => valueOf(simulation, id)))
      .toEqual([1, 0, 1, 1]);
  }, 240_000);

  it("catch-up trades without events: bought, sold and delivered wares leave the run state untouched", () => {
    const { emitted, simulation } = tradeIsland();
    simulation.setScriptMode("catchUp");
    const before = simulation.saveState().scriptRun;
    expect(simulation.tradeBuy("m0-0")).toBe(true);
    expect(simulation.tradeSetNpcTraders(true)).toBe(true);
    expect(simulation.tradePlaceOffer({ amount: 30, ware: "planks" }, { amount: 14, ware: "fish" })).toBe(true);
    expect(run(simulation, 2400, () => simulation.trade().history.some(entry => entry.kind === "sold") &&
      tradeSettled(simulation))).toBe(true);
    expect(simulation.trade().history.map(entry => entry.kind).sort()).toEqual(["bought", "sold"]);
    expect(emitted).toEqual([]);
    expect(simulation.saveState().scriptRun).toEqual(before);
    // Back in live play the next deal is heard again.
    simulation.endScriptCatchUp();
    simulation.setScriptMode("live");
    expect(simulation.tradeBuy("m0-1")).toBe(true);
    simulation.update(.05);
    expect(ofKind(emitted, "wareBought").map(emission => emission.values))
      .toEqual([{ payment: "stone", ware: "bread" }]);
  }, 240_000);
});
