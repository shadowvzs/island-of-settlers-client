import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { LEGACY_SIM_RULES } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { fromSaveSnapshot, toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import {
  islandSkipsCatchUp, onScreenSkipsCatchUp, sessionSkipsCatchUp
} from "../src/app/settlement/catch-up-skip";
import { advanceOfflineGame, skipOfflineProgress } from "../src/app/settlement/offline-progress";
import { catchUpSnapshot } from "../src/app/settlement/server-bundle";
import { skipHiddenTime } from "../src/app/settlement/tab-resume";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { ColonyRecord } from "../src/shared/settlement/archipelago";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import { huntingWorld } from "./helpers/hunting-world";

const SAVED_AT = 1_000_000;
const HOUR = 3_600_000;
const WOODCUTTER = 33;

/** A bare live island on the shared test world (no authored scenario: the start stock stays the test's own). */
const freshIsland = (clockStart = SAVED_AT) => {
  const world = huntingWorld();
  world.scenario = undefined;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ clockStart, initialSettlers: 20, initialStock: { hammer: 3, logs: 20,
    planks: 100, saw: 1, shovel: 3, stone: 100 }, roads, world });
  return { simulation, world };
};

/** A live island with a working woodcutter. */
const liveIsland = (clockStart = SAVED_AT) => {
  const { simulation, world } = freshIsland(clockStart);
  const [width, depth] = getBuildingDefinition(WOODCUTTER).gridFootprint;
  const placed = simulation.placeBuilding(WOODCUTTER, 20 + width / 2, 18 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  placed.building.construction = 1; placed.building.required = {};
  simulation.connectRoads(simulation.headquarters.access, placed.building.access);
  return { simulation, world };
};

/** One island save with a working woodcutter, optionally on an authored map (kind and rules). */
const islandSave = async (scenario?: Partial<MapScenario>, savedAt = SAVED_AT): Promise<GameSaveV1> => {
  const { simulation, world } = liveIsland();
  world.scenario = scenario && { ...createMapScenario(), ...scenario };
  return createGameSave(world, simulation.saveState(), { animals: [], name: "Skip", savedAt, source: "generated" });
};

const SKIP_COLONY: Partial<MapScenario> = { kind: "colony", rules: { offlineCatchUp: "skip" } };

const colonyRecord = (save: GameSaveV1 | undefined, conqueredAt = SAVED_AT): ColonyRecord => ({
  conqueredAt, expeditionId: 2, island: { name: "Skip Rock", voyageSeconds: 60 } as ColonyRecord["island"],
  nextOreShipAt: SAVED_AT + 1_000, save, status: "conquered"
});

/** Home on screen, colony 2 filed. */
const homeWithFiledColony = async (colony: GameSaveV1, conqueredAt?: number): Promise<GameSaveV1> => ({
  ...await islandSave(),
  archipelago: { active: null, colonies: [colonyRecord(colony, conqueredAt)], version: 1 }
});

/** Colony 2 on screen, home filed. */
const colonyOnScreen = async (colony: GameSaveV1): Promise<GameSaveV1> => {
  const { archipelago: _group, player: _player, ...home } = await islandSave();
  return { ...colony, archipelago: { active: 2, colonies: [colonyRecord(undefined)], home, version: 1 } };
};

const hashOf = (save: GameSaveV1) => hashText(canonicalJson(save.settlement));

describe("catch-up skip rules", () => {
  it("never skips the campaign role and follows the effective rule elsewhere", () => {
    expect(islandSkipsCatchUp({ catchUp: "skip" }, "campaign")).toBe(false);
    expect(islandSkipsCatchUp({ catchUp: "skip" }, "colony")).toBe(true);
    expect(islandSkipsCatchUp({ catchUp: "run" }, "adventure")).toBe(false);
  });

  it("decides the whole-save skip from the session rules or the pins", async () => {
    const save = await islandSave();
    expect(sessionSkipsCatchUp(save)).toBe(false);
    expect(sessionSkipsCatchUp(save, LEGACY_SIM_RULES)).toBe(false);
    expect(sessionSkipsCatchUp(save, { catchUp: "skip" })).toBe(true);
    const pinned = { ...save, settlement: { ...save.settlement, gameRules: { ...LEGACY_SIM_RULES,
      catchUp: "skip" as const, revision: "local:offline" } } };
    expect(sessionSkipsCatchUp(pinned)).toBe(true);
  });

  it("a home map with a map skip is refused and the home on screen never takes one", async () => {
    const home = await islandSave({ kind: "home", rules: { offlineCatchUp: "skip" } });
    const game = { ...home, archipelago: { active: null, colonies: [], version: 1 as const } };
    expect(await onScreenSkipsCatchUp(game, SAVED_AT + HOUR)).toBe(false);
    await expect(advanceOfflineGame(game, SAVED_AT + 10 * 60_000)).rejects.toThrow(/scenario/);
  }, 60_000);
});

describe("per-island map skip", () => {
  it("a filed skip colony gains nothing while home catches up", async () => {
    const colony = await islandSave(SKIP_COLONY);
    const source = await homeWithFiledColony(colony);
    const now = SAVED_AT + 10 * 60_000;
    const result = await advanceOfflineGame(structuredClone(source), now);
    const record = result.archipelago!.colonies[0]!;
    expect(record.save!.savedAt).toBe(now);
    expect(record.save!.settlement).toEqual(colony.settlement);
    expect(record.save!.settlement.gameTick ?? 0).toBe(colony.settlement.gameTick ?? 0);
    expect(record.save!.settlement.scriptRun).toEqual(colony.settlement.scriptRun);
    expect(record.nextOreShipAt).toBe(SAVED_AT + 1_000 + 10 * 60_000);
    expect(result.savedAt).toBe(now);
    expect(hashOf(result)).not.toBe(hashOf(source));
  }, 60_000);

  it("a colony without the map skip still replays (defaults unchanged)", async () => {
    const colony = await islandSave({ kind: "colony" });
    const source = await homeWithFiledColony(colony);
    const result = await advanceOfflineGame(structuredClone(source), SAVED_AT + 10 * 60_000);
    expect(result.archipelago!.colonies[0]!.save!.settlement).not.toEqual(colony.settlement);
  }, 60_000);

  it("a skip colony on screen stays on screen, untouched, while the filed home catches up", async () => {
    const colony = await islandSave(SKIP_COLONY);
    const source = await colonyOnScreen(colony);
    expect(await onScreenSkipsCatchUp(source, SAVED_AT + HOUR)).toBe(true);
    const now = SAVED_AT + 10 * 60_000;
    const result = await advanceOfflineGame(structuredClone(source), now);
    expect(result.archipelago!.active).toBe(2);
    expect(result.savedAt).toBe(now);
    expect(result.settlement).toEqual(colony.settlement);
    expect(result.archipelago!.colonies[0]!.save).toBeUndefined();
    expect(result.archipelago!.home!.savedAt).toBe(now);
    expect(hashOf(result.archipelago!.home!)).not.toBe(hashOf(source.archipelago!.home!));
  }, 60_000);

  it("a skipped colony past its lifetime still ends on the real time", async () => {
    const colony = await islandSave(SKIP_COLONY);
    const now = SAVED_AT + HOUR;
    const source = await homeWithFiledColony(colony, now - COLONY_LIFETIME_MS - 1);
    const result = await advanceOfflineGame(structuredClone(source), now);
    expect(result.archipelago!.colonies).toEqual([]);
    expect(result.archipelago!.evacuations?.[0]).toMatchObject({ deadline: now, name: "Skip Rock" });
  }, 60_000);

  it("the client guest and the server bundle reach identical hashes under a map skip", async () => {
    const colony = await islandSave(SKIP_COLONY);
    const source = await colonyOnScreen(colony);
    const now = SAVED_AT + 10 * 60_000;
    const client = await advanceOfflineGame(structuredClone(source), now);
    const server = await catchUpSnapshot(toSaveSnapshot(structuredClone(source)), now);
    const fromServer = fromSaveSnapshot(server!.snapshot)!;
    expect(hashOf(fromServer)).toBe(hashOf(client));
    expect(hashOf(fromServer.archipelago!.home!)).toBe(hashOf(client.archipelago!.home!));
    expect(fromServer.savedAt).toBe(client.savedAt);
  }, 60_000);
});

describe("hidden tab under a catch-up skip", () => {
  const OFFLINE_RULES = { ...LEGACY_SIM_RULES, catchUp: "skip" as const, revision: "local:skip-test" };
  const stateHash = (simulation: ReturnType<typeof createSettlementSimulation>) =>
    hashText(canonicalJson(simulation.saveState()));

  it("ends in the same state as the closed and reopened tab, and both continue identically", async () => {
    const { simulation: hidden, world } = liveIsland();
    expect(hidden.adoptGameRules(OFFLINE_RULES)).toBe(true);
    for (let tick = 0; tick < 200; tick++) hidden.update(.05);
    expect(islandSkipsCatchUp(hidden.effectiveGameRules(), hidden.islandRole())).toBe(true);
    const hideAt = hidden.gameNow(), tick = hidden.gameTick(), now = hideAt + 21_337;
    const save = await createGameSave(world, hidden.saveState(),
      { animals: [], name: "Skip", savedAt: hideAt, source: "generated" });

    expect(skipHiddenTime((now - hidden.gameNow()) / 1000, hidden)).toEqual({ appliedSeconds: 0,
      skippedSeconds: 21.337 });
    const reopenedSave = skipOfflineProgress(save, now).save;
    const { simulation: reopened } = freshIsland(reopenedSave.savedAt);
    expect(reopened.loadState(JSON.parse(JSON.stringify(reopenedSave.settlement)))).toEqual({ ok: true });

    expect(hidden.gameNow()).toBe(now);
    expect(reopened.gameNow()).toBe(now);
    expect(hidden.gameTick()).toBe(tick);
    expect(stateHash(reopened)).toBe(stateHash(hidden));
    for (let step = 0; step < 100; step++) { hidden.update(.05); reopened.update(.05); }
    expect(stateHash(reopened)).toBe(stateHash(hidden));
  }, 60_000);

  it("default rules keep the exact hidden-time replay", () => {
    const { simulation } = liveIsland();
    expect(islandSkipsCatchUp(simulation.effectiveGameRules(), simulation.islandRole())).toBe(false);
  });
});
