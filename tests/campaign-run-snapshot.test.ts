import { describe, expect, it } from "vitest";

import { fromSaveSnapshot, toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { type CampaignRunState, createCampaignRunState } from "../src/shared/campaign/campaign-run";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { type Archipelago, emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { activeSaveKey } from "../src/shared/settlement/game-save-rows";

/** Campaign server part 2: the run on screen is a row of the cloud snapshot, so it survives a device change. */
const save = (map: string, savedAt: number): GameSaveV1 => ({ format: "island-settlers-game", map,
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt,
  settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"],
  version: 4 });
const identity = { attempt: 7, campaignId: "isles", mapId: "bay:north" };
const run: CampaignRunState = {
  ...createCampaignRunState(identity, { attemptId: "attempt-id", mapStatus: "completed" }),
  pendingGrants: [{ goods: { planks: 4 }, id: "grant-1" }] };
const group: Archipelago = { ...emptyArchipelago(), campaign: { ...identity, appliedGrants: ["grant-0"] },
  home: save("home", 5) };
const onCampaign: GameSaveV1 = { ...save("run", 9), archipelago: group, campaignRun: run,
  player: createPlayerProgress(3) };

/** What the server answers: the uploaded snapshot after a JSON round trip. */
const stored = (game: GameSaveV1) =>
  JSON.parse(JSON.stringify(toSaveSnapshot(game))) as ReturnType<typeof toSaveSnapshot>;

describe("campaign run in the cloud snapshot", () => {
  it("uploads the run on screen as a row under its run key, beside home", () => {
    const snapshot = toSaveSnapshot(onCampaign);
    expect(snapshot.islands.map(row => row.key)).toEqual(["home", "campaign-bay:north-7"]);
    const row = snapshot.islands[1]!;
    expect(row.save).toMatchObject({ metadata: { savedAt: 9 }, schemaVersion: 4 });
    expect(row.save.data).toMatchObject({ campaignRun: run, map: "run" });
    expect(snapshot.session).toMatchObject({ active: "campaign", campaign: group.campaign });
  });

  it("reads the run back on another device with its pending and applied grants", () => {
    const game = fromSaveSnapshot(stored(onCampaign))!;
    expect(game.map).toBe("run");
    expect(game.campaignRun).toEqual(run);
    expect(game.campaignRun?.pendingGrants).toEqual([{ goods: { planks: 4 }, id: "grant-1" }]);
    expect(game.archipelago?.campaign?.appliedGrants).toEqual(["grant-0"]);
    expect(game.archipelago?.home?.map).toBe("home");
    expect(activeSaveKey(game)).toBe("campaign-bay:north-7");
    expect(toSaveSnapshot(game)).toEqual(stored(onCampaign));
  });

  it("leaves a home-only snapshot unchanged and drops the row once the run ended", () => {
    const home = { ...save("home", 20), player: createPlayerProgress(3) };
    expect(toSaveSnapshot(home).islands.map(row => row.key)).toEqual(["home"]);
    expect(fromSaveSnapshot(stored(home))?.campaignRun).toBeUndefined();
  });
});
