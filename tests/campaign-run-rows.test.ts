import { describe, expect, it, vi } from "vitest";

import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchivedIslandAccess } from "../src/app/settlement/archived-island-access";
import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import {
  campaignRunKey, type CampaignRunState, createCampaignRunState
} from "../src/shared/campaign/campaign-run";
import { campaignHomeGame, withCampaignRunOnScreen } from "../src/shared/campaign/campaign-run-game";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { addColonyRecord, type Archipelago, emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import {
  activeSaveKey, composeGameSave, splitGameSave, unreferencedCampaignRuns, unreferencedIslands
} from "../src/shared/settlement/game-save-rows";
import { createMemoryStorage } from "./memory-storage";

const island = { difficulty: "easy" as const, id: 2, name: "Gull Rock", ore: "coal" as const, seed: 9,
  voyageSeconds: 120 };
const landing = { crew: 2, landed: {}, troops: [] };
const save = (map: string, savedAt = 10): GameSaveV1 => ({ format: "island-settlers-game", map,
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt,
  settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"],
  version: 4 });
const player = { ...createPlayerProgress(3), experience: 150, gems: 5 };
const run = (attempt = 1): CampaignRunState => createCampaignRunState({ attempt, campaignId: "isles", mapId: "bay" });
const marker = (attempt = 1) => ({ attempt, campaignId: "isles", mapId: "bay" });

/** The run on screen with home and one landed colony filed. */
const onCampaign = (attempt = 1): GameSaveV1 => {
  const group: Archipelago = { ...addColonyRecord(emptyArchipelago(), 1, island, landing), campaign: marker(attempt),
    home: save("home", 5) };
  return { ...save("run", 7), archipelago: group, campaignRun: run(attempt), player };
};

/** Home on screen while the run exists (e.g. after a give-up before its return ship). */
const homeWithRun = (attempt = 1): GameSaveV1 => ({ ...save("home", 20), player,
  archipelago: { ...emptyArchipelago(), campaign: marker(attempt) } });

describe("campaign run rows", () => {
  it("stores the run on screen as its own row, never as a filed island", () => {
    const rows = splitGameSave(onCampaign());
    expect(rows.session).toMatchObject({ active: "campaign", campaign: marker() });
    expect(rows.islands.map(row => row.id)).toEqual(["home"]);
    expect(rows.campaignRuns).toEqual([{ id: "campaign-bay-1", run: run(), save: save("run", 7) }]);
    expect(rows.islands[0]!.save.map).toBe("home");
  });

  it("rebuilds the run on screen with home filed, and round trips the rows", () => {
    const rows = splitGameSave(onCampaign());
    const rebuilt = composeGameSave(rows)!;
    expect(rebuilt.map).toBe("run");
    expect(rebuilt.campaignRun).toEqual(run());
    expect(rebuilt.archipelago).toMatchObject({ active: null, campaign: marker(), home: { map: "home" } });
    expect(rebuilt.player).toEqual(player);
    expect(splitGameSave(rebuilt)).toEqual(rows);
  });

  it("keys the save on screen by the run, so command logs never read as the home island", () => {
    expect(activeSaveKey(onCampaign(3))).toBe("campaign-bay-3");
    expect(activeSaveKey(homeWithRun())).toBe("home");
    expect(campaignRunKey(marker(2))).toBe("campaign-bay-2");
  });

  it("never lists the run (or home) as an unreferenced island; the sweep finds only unnamed runs", () => {
    const rows = splitGameSave(onCampaign());
    expect(unreferencedIslands(rows)).toEqual([]);
    expect(unreferencedCampaignRuns(rows)).toEqual([]);
    const restarted = { ...rows, session: { ...rows.session, campaign: marker(2) } };
    expect(unreferencedCampaignRuns(restarted)).toEqual(["campaign-bay-1"]);
    const ended = { ...rows, session: { ...rows.session, active: null, campaign: undefined } };
    expect(unreferencedCampaignRuns(ended)).toEqual(["campaign-bay-1"]);
  });

  it("falls back to home on screen when the shown run row is missing", () => {
    const rows = splitGameSave(onCampaign());
    const rebuilt = composeGameSave({ ...rows, campaignRuns: [] })!;
    expect(rebuilt.map).toBe("home");
    expect(rebuilt.campaignRun).toBeUndefined();
    expect(rebuilt.archipelago?.campaign).toEqual(marker());
  });

  it("files home around a caught-up home game and leaves the run untouched", () => {
    const game = onCampaign(), home = campaignHomeGame(game);
    expect(home.map).toBe("home");
    expect(home.archipelago).toMatchObject({ active: null, campaign: marker(), home: undefined });
    const back = withCampaignRunOnScreen({ ...home, savedAt: 99 }, game);
    expect(back).toMatchObject({ campaignRun: run(), map: "run", savedAt: 7 });
    expect(back.archipelago?.home).toMatchObject({ map: "home", savedAt: 99 });
    expect(back.archipelago?.home).not.toHaveProperty("archipelago");
  });
});

describe("campaign run storage (localStorage fallback)", () => {
  it("restores the run, keeps a filed run across home saves, sweeps and clears runs", async () => {
    const database = openLocalStorageGame(createMemoryStorage());
    await database.writeGame("slot", onCampaign());
    expect(await database.readGame("slot")).toMatchObject({ campaignRun: run(), map: "run" });
    await database.writeGame("slot", homeWithRun());
    expect(await database.pruneIslands("slot")).toBe(0);
    expect((await database.readGame("slot"))?.map).toBe("home");
    await database.writeGame("slot", { ...onCampaign(), map: "run-again" });
    expect(await database.readGame("slot")).toMatchObject({ campaignRun: run(), map: "run-again" });
    await database.writeGame("slot", homeWithRun(2));
    expect(await database.pruneIslands("slot")).toBe(1);
    await database.writeGame("slot", onCampaign(2));
    expect((await database.readGame("slot"))?.campaignRun?.attempt).toBe(2);
    await database.writeGame("slot", { ...homeWithRun(), archipelago: undefined });
    expect(await database.pruneIslands("slot")).toBe(1);
    await database.clearGame("slot");
    expect(await database.readGame("slot")).toBeNull();
  });

  it("clears every campaign run with all games", async () => {
    const storage = createMemoryStorage(), database = openLocalStorageGame(storage);
    await database.writeGame("slot", onCampaign());
    await database.clearAllGames();
    expect(await database.readGame("slot")).toBeNull();
  });
});

describe("cross-document writes from the run", () => {
  const archiveFixture = () => {
    let group = { version: 1, active: null, campaign: marker(), home: save("home", 5), colonies: [
      { expeditionId: 2, status: "conquered", save: save("owned", 7) }
    ] } as unknown as Archipelago;
    const persisted: GameSaveV1[] = [];
    const persist = vi.fn(async (saved: GameSaveV1) => { persisted.push(saved); });
    const access = createArchivedIslandAccess({ capture: async () => ({ ...save("run", 30), campaignRun: run() }),
      group: () => group, persist: { writeSavedGame: persist }, setGroup: next => { group = next; },
      transition: createSessionLifecycle() });
    return { access, group: () => group, persisted };
  };

  it("persists a reward grant and a concurrent filed-island update without losing either", async () => {
    const { access, group, persisted } = archiveFixture();
    let release = () => {};
    const relief = access.updateArchivedIsland(2, "relief:chronology", async baseline => {
      await new Promise<void>(done => { release = done; });
      return { save: { ...baseline, map: "owned-advanced" }, value: "relief" };
    });
    const grant = access.updateArchipelago("campaign-level-up", current =>
      ({ group: { ...current, rewards: { coins: 40 } }, value: "grant" }));
    await Promise.resolve();
    release();
    expect(await relief).toEqual({ ok: true, value: "relief" });
    expect(await grant).toEqual({ ok: true, value: "grant" });
    expect(group().colonies[0]!.save!.map).toBe("owned-advanced");
    expect(group().rewards).toEqual({ coins: 40 });
    const last = persisted.at(-1)!;
    expect(last.campaignRun).toEqual(run());
    expect(last.archipelago?.rewards).toEqual({ coins: 40 });
    expect(last.archipelago?.colonies[0]!.save!.map).toBe("owned-advanced");
  });

  it("queues archipelago writes behind each other", async () => {
    const { access, group } = archiveFixture();
    const add = (coins: number) => access.updateArchipelago(`grant-${coins}`, current =>
      ({ group: { ...current, rewards: { coins: (current.rewards?.coins ?? 0) + coins } }, value: coins }));
    const results = await Promise.all([add(5), add(7)]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(group().rewards).toEqual({ coins: 12 });
  });
});
