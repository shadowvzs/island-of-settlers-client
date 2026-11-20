import { describe, expect, it } from "vitest";

import { createCampaignMap } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { GAME_SETTINGS_PRESETS } from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { isCampaignRunRowKey } from "../../island-of-settlers-shared/src/island-key";
import { browserSessionRules } from "../src/app/game-settings/browser-session-rules";
import type { SaveSnapshot } from "../src/app/save-store/save-api-client";
import { fromSaveSnapshot, toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { buildHomelessRunGame } from "../src/app/settlement/campaign-homeless-run";
import { catchUpSnapshot, checkPlausibility } from "../src/app/settlement/server-bundle";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import { bayHarbourPlot, bayWorld } from "./helpers/campaign-bay-world";

/** ONLINE-STORY: the server runs the client bundle over a slot without a home island; nothing home-bound runs. */

const NOW = 1_800_000_000_000;
const STORY_RULES = browserSessionRules(GAME_SETTINGS_PRESETS.story, false)!;

const loadedMap = (): LoadedMap => {
  const world = bayWorld();
  world.scenario = { ...createMapScenario(), harbourPlot: bayHarbourPlot(), kind: "campaign" };
  return { animals: [], meta: { name: "Bay", savedAt: 0, source: "generated" }, terrain: null, world };
};

const storySnapshot = async () => toSaveSnapshot(await buildHomelessRunGame({ loaded: loadedMap(),
  map: { ...createCampaignMap("first", "isles", { hash: null, id: "slot-first" }), state: "ready" },
  nation: "roman", now: NOW, player: createPlayerProgress(7), rules: STORY_RULES }));

/** The slot between two maps: the player row only (what the client uploads after a run without a home). */
const betweenMaps = (snapshot: SaveSnapshot): SaveSnapshot => ({ ...snapshot, islands: [],
  session: { active: null, savedAt: NOW } });

describe("server bundle over a slot without a home island", () => {
  it("uploads the run as its only row, pinned to rules without a home (the server's homeless shape)", async () => {
    const snapshot = await storySnapshot();
    expect(snapshot.islands).toHaveLength(1);
    const [row] = snapshot.islands;
    expect(isCampaignRunRowKey(row!.key)).toBe(true);
    expect((row!.save.data as { settlement: { gameRules: { homeIsland: boolean } } }).settlement.gameRules.homeIsland)
      .toBe(false);
    expect([snapshot.colonies, snapshot.adventures, snapshot.evacuations]).toEqual([[], [], []]);
    expect(fromSaveSnapshot(snapshot)?.campaignRun?.mapId).toBe("first");
  });

  it("has no home catch-up: the run and the empty slot answer null (no write)", async () => {
    const snapshot = await storySnapshot();
    await expect(catchUpSnapshot(snapshot, NOW + 3_600_000, {}, { granted: STORY_RULES })).resolves.toBeNull();
    await expect(catchUpSnapshot(snapshot, NOW + 3_600_000)).resolves.toBeNull();
    await expect(catchUpSnapshot(betweenMaps(snapshot), NOW + 3_600_000)).resolves.toBeNull();
  });

  it("checks plausibility of run uploads without a home and skips an empty slot", async () => {
    const snapshot = await storySnapshot();
    const result = await checkPlausibility({ after: snapshot, before: snapshot, credits: {}, realSeconds: 60 });
    expect(result.violations).toEqual([]);
    await expect(checkPlausibility({ after: betweenMaps(snapshot), before: snapshot, credits: {}, realSeconds: 60 }))
      .resolves.toEqual({ seconds: 0, violations: [] });
  });
});
