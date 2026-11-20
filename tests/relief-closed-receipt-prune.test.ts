import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { createPlayerReliefSession } from "../src/app/settlement/player-relief-session";
import { createReliefIslandPort } from "../src/app/settlement/relief-island-port";
import { refreshQuests } from "../src/shared/progression/player-progress";
import { type ColonyRecord, expireColony } from "../src/shared/settlement/archipelago";
import { pruneClaimedReliefReceipts } from "../src/shared/settlement/archipelago-relief";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

it("keeps an old completed identity until its closed receipt is pruned, then releases both", async () => {
  const save: GameSaveV1 = JSON.parse(await readFile(resolve(
    "tests/fixtures/relief-collection/stage-2601.save.json"), "utf8"));
  const colony: ColonyRecord = { expeditionId: 2, status: "conquered", save,
    conqueredAt: save.savedAt - COLONY_LIFETIME_MS, island: { id: 1, seed: save.settlement.world.seed,
      name: "Authored closed source", difficulty: "easy", ore: "ironOre", voyageSeconds: 60 } };
  let group = expireColony({ version: 1, active: null, colonies: [colony] }, colony, save.savedAt);
  let player = structuredClone(save.player!);
  player.relief!.missions[0]!.stage = "completed";
  player.quests[0]!.done = true;
  player = refreshQuests(player, "2026-10-29", undefined, "roman", { reliefAvailable: false });
  expect(player.questDay).toBe("2026-10-29");
  expect(player.quests).toHaveLength(1);
  const port = createReliefIslandPort({ archivedOwnedIslands: () => [],
    archivedReliefReceipts: () => group.reliefReceipts ?? [],
    updateArchivedIsland: async () => { throw new Error("Closed sources never mutate"); } });
  const session = createPlayerReliefSession({ get: () => player, refresh: () => player,
    commit: next => { player = next; }, simulation: () => undefined, port: () => port, localize: text => text });
  session.prune();
  expect(player.relief!.missions[0]?.stage).toBe("completed");
  group = pruneClaimedReliefReceipts(group, player);
  expect(group.reliefReceipts).toBeUndefined(); expect(port.newAidBlocker()).toBeUndefined();
  session.prune(); expect(player.relief!.missions).toEqual([]);
});
