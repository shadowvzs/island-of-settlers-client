import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { createLocalSaveStore } from "../src/app/save-store/local-save-store";
import { runArchivedReliefNative } from "../src/app/settlement/archived-relief-native";
import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import { archivedIslandProof } from "../src/shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createMemoryStorage } from "./memory-storage";

it("durably compacts guest journals across seventy native chunks and two finite paid requests with store reopens", async () => {
  const storage = createMemoryStorage();
  let store = createLocalSaveStore(openLocalStorageGame(storage));
  let game: GameSaveV1 = JSON.parse(await readFile(resolve(
    "tests/fixtures/relief-archive/paid.save.json"), "utf8"));
  const initial = game.archipelago!.home!, initialXP = game.player!.experience;
  const stored = (save: GameSaveV1) => save.settlement.buildings.reduce((sum, building) =>
    sum + (building.inventory.ironOre ?? 0), 0) +
    save.settlement.storagePools.pools.reduce((sum, pool) => sum + (pool.available.ironOre ?? 0), 0);
  const peopleOf = (save: GameSaveV1) => save.settlement.settlers +
    save.settlement.actors.filter(actor => actor.phase !== "retired").length;
  const freeBefore = stored(initial), people = peopleOf(initial);
  // Explicit browser-only policy can compact an imported retained chain at the first durable boundary.
  game = await store.writeArchivedIslandGame!(game, archivedIslandProof(initial)!) as GameSaveV1;
  for (let chunk = 0; chunk < 70; chunk++) {
    const baseline = game.archipelago!.home!;
    const next = await runArchivedReliefNative(baseline, "home", simulation => {
      if (chunk === 35) expect(simulation.requestReliefCollection({ version: 1,
        questId: "authored-second-request", ware: "ironOre", amount: 4 })).toMatchObject({ ok: true });
    }, baseline.savedAt + 50, game.savedAt);
    expect(next.proof.intervals).toHaveLength(1);
    const payload = { ...game, player: next.player, archipelago: { ...game.archipelago!, home: next.save } };
    const canonical = await store.writeArchivedIslandGame!(payload, next.proof) as GameSaveV1;
    expect(archivedIslandProof(canonical.archipelago!.home!)).toBeUndefined();
    store = createLocalSaveStore(openLocalStorageGame(storage));
    game = (await store.readSavedGame())!;
    expect(archivedIslandProof(game.archipelago!.home!)).toBeUndefined();
  }
  const home = game.archipelago!.home!;
  expect(home.settlement.reliefCollections!.jobs).toHaveLength(2);
  expect(home.settlement.reliefCollections!.jobs.every(job => job.amount === 4 && !job.departed)).toBe(true);
  expect(stored(home)).toBe(freeBefore - 4);
  expect(peopleOf(home)).toBe(people +
    (home.settlement.settlerBirths - initial.settlement.settlerBirths));
  expect(game.player!.experience).toBe(initialXP);
  expect(home.savedAt - initial.savedAt).toBe(3500);
}, 30_000);
