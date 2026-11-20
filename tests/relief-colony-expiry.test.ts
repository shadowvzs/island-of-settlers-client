import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { createReliefIslandPort } from "../src/app/settlement/relief-island-port";
import { type Archipelago, type ColonyRecord, expireColony, validateArchipelago } from "../src/shared/settlement/archipelago";
import { applyReturnedColonyRelief, pendingColonyRelief, pruneClaimedReliefReceipts } from "../src/shared/settlement/archipelago-relief";
import { colonyExpiryAssets } from "../src/shared/settlement/colony-expiry-assets";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { composeGameSave, splitGameSave } from "../src/shared/settlement/game-save-rows";

const load = async (name: string): Promise<GameSaveV1> => JSON.parse(await readFile(resolve(
  `tests/fixtures/relief-collection/${name}.save.json`), "utf8"));
const record = (save: GameSaveV1): ColonyRecord => ({ expeditionId: 2, status: "conquered", save,
  conqueredAt: save.savedAt - COLONY_LIFETIME_MS, island: { id: 1, seed: save.settlement.world.seed,
    name: "Authored expiry source", difficulty: "easy", ore: "ironOre", voyageSeconds: 60 } });

it.each([0, 1795, 2159, 2325, 2601])("returns exact physical paid aid once at actual native stage %s, without extending ownership", async tick => {
  const save = await load(`stage-${tick}`), before = JSON.stringify(save), colony = record(save);
  const group: Archipelago = { version: 1, active: null, colonies: [colony] };
  const job = save.settlement.reliefCollections!.jobs[0]!, expected = job.departed ? 92 : 96;
  expect(colonyExpiryAssets(save).cargo.ironOre).toBe(expected);
  const ended = expireColony(group, colony, save.savedAt + 1);
  expect(ended.colonies).toEqual([]); expect(ended.evacuations![0]!.cargo.ironOre).toBe(expected);
  expect(JSON.stringify(save)).toBe(before);
  expect(expireColony(ended, colony, save.savedAt + 2)).toBe(ended);
  expect(ended.reliefReceipts?.length ?? 0).toBe(job.departed ? 1 : 0);
  const player = applyReturnedColonyRelief(save.player, pendingColonyRelief(save))!;
  expect(player.relief!.missions[0]!.stage).toBe(job.departed ? "ready-to-claim" : "returned");
  expect(player.experience).toBe(save.player!.experience);
});

it("persists closed ready evidence through table rows without ownership, payment, ticks or claim loss", async () => {
  const save = await load("stage-2601"), colony = record(save);
  const ended = expireColony({ version: 1, active: null, colonies: [colony] }, colony, save.savedAt + 1);
  const game = { ...await load("awaiting"), archipelago: ended, player: save.player };
  const restored = composeGameSave(JSON.parse(JSON.stringify(splitGameSave(game))))!;
  expect(validateArchipelago(restored.archipelago)).toBeNull();
  const group = restored.archipelago!, receipt = group.reliefReceipts![0]!;
  expect(receipt.colony.expeditionId).toBe(2); expect(receipt.save.player).toBeUndefined();
  expect(receipt.save.archipelago).toBeUndefined(); expect(group.colonies).toEqual([]);
  const port = createReliefIslandPort({ archivedOwnedIslands: () => [], archivedReliefReceipts: () => group.reliefReceipts!,
    updateArchivedIsland: async () => { throw new Error("A closed source must never mutate"); } });
  expect(port.statuses()[0]!.stage).toBe("ready-to-claim");
  expect(await port.list("ironOre")).toEqual([]); expect(port.newAidBlocker()).toContain("Claim");
  expect(pruneClaimedReliefReceipts(group, save.player)).toBe(group);
  const completed = structuredClone(save.player!); completed.relief!.missions[0]!.stage = "completed";
  completed.quests[0]!.done = true;
  expect(pruneClaimedReliefReceipts(group, completed).reliefReceipts).toBeUndefined();
});

it("caps true archived native ticks at the existing colony lifetime deadline", async () => {
  const { createArchivedIslandAccess } = await import("../src/app/settlement/archived-island-access");
  const { createArchivedReliefCoordinator } = await import("../src/app/settlement/archived-relief-coordinator");
  const { createSessionLifecycle } = await import("../src/app/session-lifecycle");
  const source = await load("stage-0"); delete source.runtime;
  const colony = { ...record(source), conqueredAt: source.savedAt - COLONY_LIFETIME_MS + 2000 };
  let group: Archipelago = { version: 1, active: null, colonies: [colony] };
  const access = createArchivedIslandAccess({ group: () => group, setGroup: next => { group = next; },
    capture: async () => source, persist: { writeSavedGame: async () => {} }, transition: createSessionLifecycle(),
    player: () => source.player!, now: () => source.savedAt + 60_000 });
  const owner = createArchivedReliefCoordinator({ archive: access, now: () => source.savedAt + 60_000, busy: () => false });
  expect((await owner.advanceTo(source.savedAt + 60_000))[0]!.result.ok).toBe(true);
  expect(group.colonies[0]!.save!.savedAt).toBe(source.savedAt + 2000);
  const port = createReliefIslandPort({ ...access });
  expect(await port.list("ironOre")).toEqual([]); // A stale filed clock cannot admit a payment after the real deadline.
  owner.dispose();
});

it.each([false, true])("refuses manual abandonment with pending aid while active=%s without changing custody", async active => {
  const { createArchipelagoSession } = await import("../src/app/settlement/archipelago-session");
  const source = await load("stage-0"), colony = { ...record(source), conqueredAt: source.savedAt };
  if (active) colony.save = undefined;
  const initial: Archipelago = { version: 1, active: active ? 2 : null, colonies: [colony], home: active ? source : undefined };
  const writes: GameSaveV1[] = [], messages: string[] = [];
  const simulation = { colonyExpeditions: () => [], colony: () => undefined, adventure: () => undefined,
    gameNow: () => source.savedAt, saveState: () => active ? source.settlement : {},
    releaseColony: () => true, talentModifiers: () => ({ shippingTimeReduction: 0 }) } as any;
  const travel = createArchipelagoSession({ initial, simulation, capture: async () => source,
    store: { writeSavedGame: async save => { writes.push(save); }, writeStartupGame: async () => {} },
    reload: () => {}, notify: text => messages.push(text) });
  const before = JSON.stringify(initial);
  expect(await travel.disband(2)).toBe(false); expect(writes).toEqual([]);
  expect(messages.at(-1)).toBe("Wait for the paid relief ship before abandoning this island");
  expect(JSON.stringify(initial)).toBe(before); travel.dispose();
});

it("marks active-colony paid aid returned in the same expiry handoff that refunds its source", async () => {
  const { createArchipelagoSession } = await import("../src/app/settlement/archipelago-session");
  const { createSessionLifecycle } = await import("../src/app/session-lifecycle");
  const source = await load("stage-0"), home = await load("awaiting"), colony = record(source);
  delete colony.save;
  let progress = source.player!;
  const returned: string[] = [], writes: GameSaveV1[] = [], transition = createSessionLifecycle();
  const simulation = { colonyExpeditions: () => [], colony: () => undefined, adventure: () => undefined,
    gameNow: () => source.savedAt + 1, saveState: () => source.settlement,
    talentModifiers: () => ({ shippingTimeReduction: 0 }) } as any;
  const travel = createArchipelagoSession({ initial: { version: 1, active: 2, colonies: [colony], home }, simulation,
    player: () => progress, capture: async () => ({ ...source, player: progress }), transition,
    onReliefReturned: records => { returned.push(...records.map(row => row.questId)); progress = applyReturnedColonyRelief(progress, records)!; },
    store: { writeSavedGame: async save => { writes.push(save); }, writeStartupGame: async () => {} },
    reload: () => {}, notify: () => {} });
  travel.update(1);
  for (let wait = 0; wait < 50 && transition.busy(); wait++) await new Promise(done => setTimeout(done, 0));
  expect(returned).toEqual([source.player!.quests[0]!.id]);
  expect(progress.relief!.missions[0]!.stage).toBe("returned");
  expect(writes.at(-1)!.player!.relief!.missions[0]!.stage).toBe("returned");
  expect(writes.at(-1)!.archipelago!.colonies).toEqual([]);
  expect(progress.experience).toBe(source.player!.experience); travel.dispose();
});
