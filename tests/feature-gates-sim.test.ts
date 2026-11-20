import { describe, expect, it } from "vitest";

import { LEGACY_SIM_RULES, type SimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { FEATURE_REASONS } from "../src/shared/settlement/feature-rules";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { createSettlementTrade } from "../src/shared/trade/settlement-trade";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { FOG, type WorldData } from "../src/shared/world/world-data";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import { advance } from "./helpers/military-assault-fixture";

/** GS4a: the single-player feature switches and fog of war, read only through `rulesOf`. */

const rulesWith = (change: Partial<SimRules>, revision = "rev-gs4a"): SimRules =>
  ({ ...LEGACY_SIM_RULES, ...change, level: { ...LEGACY_SIM_RULES.level }, revision });

const storage = (uid: number, typeId: number, inventory: Record<string, number>) => ({
  access: { x: 0, z: 0 }, construction: 1, incoming: {}, input: {}, inventory, output: {}, required: {}, typeId, uid
}) as unknown as SettlementBuilding;

const tradeIsland = () => {
  const buildings = [storage(1, 0, { planks: 400 }), storage(2, 39, {})];
  const context = { actors: [], buildings, options: { now: () => 5_000, playerLevel: () => 1, world: { seed: 4 } } } as
    unknown as SettlementContext;
  return { buildings, context, trade: createSettlementTrade(context) };
};

const hiddenFog = (world: WorldData) => { world.fog = new Uint8Array(world.cellsX * world.cellsZ).fill(FOG.hidden); };
const fogIsland = () => createBalanceSimulation(40, 77, undefined, hiddenFog);
const hashOf = (sim: SettlementSimulation) => hashText(canonicalJson(sim.saveState()));

describe("trade office switch", () => {
  it("refunds open offers, refuses new ones with featureOff and keeps the calendar still while off", () => {
    const { buildings, context, trade } = tradeIsland();
    trade.update(1);
    expect(trade.placeOffer({ amount: 100, ware: "planks" }, { amount: 50, ware: "fish" })).toBe(true);
    const stocked = () => buildings.reduce((sum, building) => sum + (building.inventory.planks ?? 0), 0) +
      trade.snapshot().escrow.reduce((sum, escrow) => sum + (escrow.goods.planks ?? 0), 0);
    expect(stocked()).toBe(400);
    context.gameRules = rulesWith({ trade: false });
    trade.applyRules();
    const state = trade.snapshot();
    expect([state.offers.length, state.escrow.length, state.history.at(-1)?.kind]).toEqual([0, 0, "cancelled"]);
    expect(buildings.reduce((sum, building) => sum + (building.inventory.planks ?? 0), 0)).toBe(400);
    expect(trade.placeOffer({ amount: 10, ware: "planks" }, { amount: 5, ware: "fish" }))
      .toBe(FEATURE_REASONS.featureOff);
    expect(trade.checkBuy(state.market!.offers[0]!.id)).toBe(FEATURE_REASONS.featureOff);
    expect(trade.setProtectedFloor("fish", 3)).toBe(false);
    trade.update(600);
    expect(trade.snapshot().elapsed).toBe(state.elapsed);
    expect(trade.save()?.floors).toEqual(state.floors);
  });

  it("a map that narrows trading refuses with the island reason", () => {
    const { context, trade } = tradeIsland();
    (context.options.world as WorldData).scenario = { ...createMapScenario(), rules: { features: { trade: "off" } } };
    expect(trade.placeOffer({ amount: 10, ware: "planks" }, { amount: 5, ware: "fish" })).toBe(FEATURE_REASONS.mapOff);
  });
});

describe("feature state and fog of war in the simulation", () => {
  it("default rules change nothing: features on, fog bytes untouched", () => {
    const sim = fogIsland();
    for (const key of ["adventures", "colonies", "explorationExpeditions", "settlementExpeditions", "trade"] as const)
      expect(sim.featureState(key)).toBe("on");
    expect(sim.saveState()).not.toHaveProperty("gameRules");
  });

  it("adopting fog off reveals the island, hides exploring and replays to the same hash", () => {
    const sim = fogIsland();
    advance(sim, .25);
    const replica = fogIsland();
    expect(replica.loadState(structuredClone(sim.saveState())).ok).toBe(true);
    const recorder = createCommandLogRecorder(sim, { sourceVersion: "test" });
    recorder.open();
    expect(sim.adoptGameRules(rulesWith({ fogOfWar: false, trade: false }))).toBe(true);
    expect(sim.featureState("explorationExpeditions")).toBe("gameOff");
    expect(sim.featureState("trade")).toBe("gameOff");
    expect(sim.tradePlaceOffer({ amount: 5, ware: "planks" }, { amount: 5, ware: "stone" }))
      .toBe(FEATURE_REASONS.featureOff);
    advance(sim, .5);
    const interval = recorder.close("home")!;
    expect(replayCommandLog(replica, interval)).toEqual({ endChecksum: interval.endChecksum, ok: true });
    expect(hashOf(replica)).toBe(hashOf(sim));
    const reloaded = fogIsland();
    expect(reloaded.loadState(structuredClone(sim.saveState())).ok).toBe(true);
    expect(hashOf(reloaded)).toBe(hashOf(sim));
  }, 120_000);

  it("harbour launches refuse while their switch is off: colonies, adventures, settlement expeditions", () => {
    const sim = fogIsland();
    expect(sim.adoptGameRules(rulesWith({ adventures: false, colonies: false, settlementExpeditions: false })))
      .toBe(true);
    expect(sim.startColonyExpedition(1, 1, {})).toEqual({ ok: false, reason: FEATURE_REASONS.featureOff });
    expect(sim.startAdventureExpedition(1, 1, {})).toEqual({ ok: false, reason: FEATURE_REASONS.featureOff });
    expect(sim.queueSeaExpedition(1, { rotation: 0, x: 10, z: 10 })).toBeNull();
    expect(sim.featureState("colonies")).toBe("gameOff");
  });

  it("a save pinned to fog off without a command (server catch-up) is revealed on load", () => {
    const sim = fogIsland();
    const pinned = { ...structuredClone(sim.saveState()), gameRules: rulesWith({ fogOfWar: false }) };
    let world: WorldData | undefined;
    const target = createBalanceSimulation(40, 77, undefined, shaped => { hiddenFog(shaped); world = shaped; });
    expect(target.loadState(pinned).ok).toBe(true);
    expect(world!.fog.every(cell => cell === FOG.visible)).toBe(true);
    expect(world!.permanentFog!.every(cell => cell === FOG.visible)).toBe(true);
  });
});

describe("fog of war off through the server verifier (headless replay)", () => {
  it("adopting fog and trade off on a fog save verifies with the server's copy of the revision", async () => {
    const { toSaveSnapshot } = await import("../src/app/save-store/save-snapshot");
    const { verifyCommandLogs } = await import("../src/app/settlement/command-log-verify");
    const { createHeadlessIsland } = await import("../src/app/settlement/headless-replay");
    const { determinismIslandSave } = await import("./helpers/determinism-island");
    const { unpackFog } = await import("../src/shared/settlement/save-cell-codecs");
    const issued = rulesWith({ fogOfWar: false, trade: false }, "rev-fog-off");
    const base = await determinismIslandSave();
    expect(unpackFog(base.progress.fog, base.progress.fog.length).some(cell => cell !== FOG.visible)).toBe(true);
    const client = await createHeadlessIsland(base), { simulation } = client;
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    expect(simulation.adoptGameRules(issued)).toBe(true);
    for (let tick = 0; tick < 20; tick++) simulation.update(.05);
    const interval = recorder.close("home")!;
    const endGame = await client.save();
    const fog = unpackFog(endGame.progress.fog, base.progress.fog.length);
    expect(fog.every(cell => cell === FOG.visible)).toBe(true);
    const chain = { base: toSaveSnapshot(base), end: toSaveSnapshot(endGame),
      intervals: [{ ...interval, baseRevision: 1 }] };
    const rules = { [issued.revision]: issued, legacy: LEGACY_SIM_RULES };
    expect(await verifyCommandLogs({ ...chain, rules })).toMatchObject({ status: "verified" });
  }, 120_000);
});
