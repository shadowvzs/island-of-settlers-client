import { describe, expect, it } from "vitest";

import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland, createHeadlessSimulation } from "../src/app/settlement/headless-replay";
import { campaignRunKey, createCampaignRunState } from "../src/shared/campaign/campaign-run";
import { campaignRunWorld, campaignStartOptions } from "../src/shared/campaign/campaign-start";
import { emptyArchipelago } from "../src/shared/settlement/archipelago";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { bayHarbourPlot, bayWorld } from "./helpers/campaign-bay-world";
import { determinismIslandSave } from "./helpers/determinism-island";

/**
 * Campaign server part 2 / C12 follow-up: the server replays a campaign run's command log chain like an island's and
 * reports the attempt and the outcome the replay reached; only a victory decided inside the replay counts.
 */
const RULES = { commanderAllowed: false, disabledBuildings: [], lodgeAllowed: false };
const CARGO = { goods: [], settlers: 2, soldiers: [] };
const IDENTITY = { attempt: 3, campaignId: "isles", mapId: "bay" };
const KEY = campaignRunKey(IDENTITY);
const SAVED_AT = 10_000_000;

/** A fresh run of a map won by surviving three seconds, with home filed under the run's marker. */
const runStart = async (): Promise<GameSaveV1> => {
  const world = bayWorld();
  world.scenario = { ...createMapScenario(), harbourPlot: bayHarbourPlot(), kind: "campaign", units: [] };
  const runWorld = campaignRunWorld(world, RULES);
  const map = { regions: [], victory: { kind: "surviveTime" as const, seconds: 3 } };
  const simulation = createHeadlessSimulation(runWorld,
    { ...campaignStartOptions({ cargo: CARGO, map, nation: "roman" }), clockStart: SAVED_AT });
  const save = await createGameSave(runWorld, simulation.saveState(),
    { animals: [], name: "Bay", savedAt: SAVED_AT, source: "generated" });
  const home = await determinismIslandSave();
  return { ...save, archipelago: { ...emptyArchipelago(), campaign: IDENTITY, home },
    campaignRun: createCampaignRunState(IDENTITY, { attemptId: "attempt-1", mapStatus: "available" }) };
};

/** One upload interval of play from `base`; the end snapshot keeps the run state and the filed home. */
const play = async (base: GameSaveV1, ticks: number) => {
  const client = await createHeadlessIsland(base), { simulation } = client;
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
  recorder.open();
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
  const interval = recorder.close(KEY)!;
  const end: GameSaveV1 = { ...await client.save(), archipelago: base.archipelago, campaignRun: base.campaignRun };
  return { base: toSaveSnapshot(base), end: toSaveSnapshot(end), endGame: end,
    intervals: [{ ...interval, baseRevision: 1 }] };
};

describe("campaign run verification", () => {
  it("verifies the run's chain and reports a victory decided inside the replay", async () => {
    const won = await play(await runStart(), 80);
    expect(won.endGame.settlement.campaignMap?.outcome?.kind).toBe("victory");
    expect(await verifyCommandLogs(won)).toMatchObject({ status: "verified", campaignRun: { attempt: 3,
      attemptId: "attempt-1", campaignId: "isles", decided: true, mapId: "bay", outcome: "victory" } });

    // A later chain starts from the won baseline: still a victory, but not one this replay decided.
    const later = await play(won.endGame, 20);
    expect(await verifyCommandLogs(later)).toMatchObject({ status: "verified",
      campaignRun: { decided: false, outcome: "victory" } });
  }, 120_000);

  it("reports a running map without an outcome", async () => {
    const running = await play(await runStart(), 20);
    const result = await verifyCommandLogs(running);
    expect(result).toMatchObject({ status: "verified", campaignRun: { decided: false } });
    expect(result.campaignRun?.outcome).toBeUndefined();
  }, 120_000);
});
