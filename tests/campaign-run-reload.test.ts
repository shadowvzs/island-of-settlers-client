import { describe, expect, it } from "vitest";

import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { advanceOfflineGame, skipOfflineProgress } from "../src/app/settlement/offline-progress";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { campaignRunMarker, createCampaignRunState } from "../src/shared/campaign/campaign-run";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { huntingWorld } from "./helpers/hunting-world";
import { createMemoryStorage } from "./memory-storage";

const HOME_SAVED_AT = 1_000_000, RUN_SAVED_AT = 400_000, MINUTE = 60_000;
const run = createCampaignRunState({ attempt: 1, campaignId: "isles", mapId: "bay" });

/** A small island with a working sawmill: a catch-up visibly changes it. */
const islandSave = async (savedAt: number) => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ clockStart: savedAt, initialSettlers: 20, roads, world,
    initialStock: { hammer: 3, logs: 20, pickaxe: 1, planks: 100, saw: 1, shovel: 3, stone: 100 } });
  const [width, depth] = getBuildingDefinition(33).gridFootprint;
  const placed = simulation.placeBuilding(33, 20 + width / 2, 18 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  placed.building.construction = 1; placed.building.required = {};
  expect(simulation.connectRoads(simulation.headquarters.access, placed.building.access)).toBe(true);
  return createGameSave(world, simulation.saveState(), { animals: [], name: "Campaign C2", savedAt,
    source: "generated" });
};

/** The run on screen (saved at its own, older tick) with home filed. */
const campaignGame = async (runSave?: GameSaveV1): Promise<GameSaveV1> => {
  const home = await islandSave(HOME_SAVED_AT), shown = runSave ?? await islandSave(RUN_SAVED_AT);
  const { archipelago: _group, player: _player, ...bare } = shown;
  return { ...bare, archipelago: { active: null, campaign: campaignRunMarker(run), colonies: [], home, version: 1 },
    campaignRun: run };
};

const hashOf = (island: Awaited<ReturnType<typeof createHeadlessIsland>>) =>
  hashSettlementState({ settlement: island.simulation.saveState(), world: island.world });

const tick = (island: Awaited<ReturnType<typeof createHeadlessIsland>>, count: number) => {
  for (let step = 0; step < count; step++) island.simulation.update(0.05);
};

describe("campaign run catch-up and reload", () => {
  it("catches up home only: the run on screen keeps its save and its tick", async () => {
    const game = await campaignGame(), now = HOME_SAVED_AT + 10 * MINUTE;
    const caught = await advanceOfflineGame(game, now);
    expect(caught.savedAt).toBe(RUN_SAVED_AT);
    expect(caught.settlement).toEqual(game.settlement);
    expect(caught.map).toBe(game.map);
    expect(caught.campaignRun).toEqual(run);
    expect(caught.archipelago?.campaign).toEqual(campaignRunMarker(run));
    expect(caught.archipelago?.home?.savedAt).toBe(now);
    expect(caught.archipelago?.home?.settlement).not.toEqual(game.archipelago!.home!.settlement);
    const skipped = skipOfflineProgress(game, now);
    expect(skipped.save.settlement).toBe(game.settlement);
    expect(skipped.save.savedAt).toBe(RUN_SAVED_AT);
    expect(skipped.save.archipelago?.home?.savedAt).toBe(now);
  });

  it("reloads a campaign map at the same tick with the same hash and stays in step", async () => {
    const live = await createHeadlessIsland(await campaignGame());
    tick(live, 120);
    const saved = await campaignGame(await live.save());
    const database = openLocalStorageGame(createMemoryStorage());
    await database.writeGame("slot", saved);
    const stored = (await database.readGame("slot"))!;
    // The boot route: home catches up to the real clock; the run boots from its own saved tick.
    const booted = await advanceOfflineGame(stored, HOME_SAVED_AT + 30 * MINUTE);
    expect(booted.savedAt).toBe(saved.savedAt);
    const reloaded = await createHeadlessIsland(booted);
    expect(reloaded.simulation.gameNow()).toBe(live.simulation.gameNow());
    expect(hashOf(reloaded)).toBe(hashOf(live));
    tick(live, 80);
    tick(reloaded, 80);
    expect(hashOf(reloaded)).toBe(hashOf(live));
  });
});
