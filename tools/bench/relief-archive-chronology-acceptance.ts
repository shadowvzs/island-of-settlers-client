import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { createSessionLifecycle } from "../../src/app/session-lifecycle";
import { createArchipelagoSession } from "../../src/app/settlement/archipelago-session";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { createReliefIslandPort } from "../../src/app/settlement/relief-island-port";
import { type Archipelago, travelTo } from "../../src/shared/settlement/archipelago";
import { archivedIslandProof } from "../../src/shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

const colonyDonor = process.env.DONOR === "colony";
const output = resolve(process.env.OUT ?? "../resources/project-reviews/acceptance-2026-10-28/relief-archive-chronology");
await mkdir(output, { recursive: true });
const persist = async (name: string, value: unknown) => writeFile(resolve(output, name), JSON.stringify(value, null, 2));
// Tracked inputs: the 2026-10-28 receipts migrated to the current save shape (TF-1, red-tests-5).
const readFixture = async (path: string): Promise<GameSaveV1> => JSON.parse(await readFile(resolve(path), "utf8"));
const donor = await readFixture("tests/fixtures/relief-collection/awaiting.save.json");
const colony = await readFixture("tests/fixtures/relief-archive/high-colony-branch.save.json");
// Explicitly authored common clock/nation before the trusted fixture anchor; no elapsed work is claimed here.
donor.savedAt = colony.savedAt;
donor.settlement.playerNation = colony.settlement.playerNation;
donor.player!.commander = colony.player!.commander;
let progress = structuredClone(donor.player!);
const initialGroup: Archipelago = { version: 1, active: null, colonies: [{ ...colony.archipelago!.colonies[0]!,
  save: { ...colony, archipelago: undefined, player: undefined } }] };
if (colonyDonor) {
  // Authored finite conquered donor; its actual native work begins only after this trusted anchor.
  const record = initialGroup.colonies[0]!;
  record.status = "conquered";
  record.conqueredAt = donor.savedAt - 60 * 60 * 1000;
  record.nextOreShipAt = donor.savedAt + 60 * 1000;
  record.island = { ...record.island, seed: donor.settlement.world.seed };
  record.save = { ...structuredClone(donor), archipelago: undefined, player: undefined };
}
const baseline = { ...donor, archipelago: initialGroup };
let abroad: GameSaveV1 = baseline;
if (!colonyDonor) abroad = travelTo(initialGroup, donor, 2) as GameSaveV1;
const donorId = colonyDonor ? 2 : null;
const active = await createHeadlessIsland(abroad);
const transition = createSessionLifecycle();
const writes: GameSaveV1[] = [], contexts: GameSaveV1[] = [];
const capture = async () => ({ ...await active.save(), player: structuredClone(progress) });
let travel = createArchipelagoSession({ capture, initial: abroad.archipelago, simulation: active.simulation,
  settle: async () => { contexts.push(travel.attach(await capture())); },
  now: active.simulation.gameNow, player: () => progress,
  prepareArchivedProgress: next => next,
  acceptArchivedProgress: (expected, next) => {
    assert.deepEqual(progress, expected, "Active player stays frozen through publication"); progress = next; return true;
  }, sourceVersion: "a".repeat(40), transition, notify: () => {}, reload: () => {},
  store: { writeSavedGame: async save => { writes.push(structuredClone(save)); }, writeStartupGame: async () => {} } });
let port = createReliefIslandPort(travel);
const quest = progress.quests[0]!;
const candidate = (await port.list(quest.ware)).find(candidate => candidate.islandId === donorId)!;
assert(candidate && candidate.available >= quest.amount);
const activeBefore = active.simulation.resourceTotal(quest.ware);
assert.equal((await port.reserve(candidate, { version: 1, questId: quest.id, ware: quest.ware, amount: quest.amount })).ok, true);
assert.equal(active.simulation.resourceTotal(quest.ware), activeBefore, "Foreign active island never pays archive goods");
await persist("base.save.json", baseline);
await persist("paid.save.json", travel.attach(await capture()));
let restored = false, steps = 0;
for (; steps < 16000; steps++) {
  if (!transition.frozen()) { active.simulation.update(.05); travel.update(.05); }
  await travel.whenArchivedReliefIdle();
  const status = port.statuses()[0]!;
  if (!restored && status.loaded > 0 && !status.departed) {
    const checkpoint = JSON.parse(JSON.stringify(travel.attach(await capture()))) as GameSaveV1;
    await persist("departing.save.json", checkpoint);
    travel.dispose();
    travel = createArchipelagoSession({ capture, initial: checkpoint.archipelago, simulation: active.simulation,
      settle: async () => { contexts.push(travel.attach(await capture())); },
      now: active.simulation.gameNow, player: () => progress, prepareArchivedProgress: next => next,
      acceptArchivedProgress: (expected, next) => { assert.deepEqual(progress, expected); progress = next; return true; },
      sourceVersion: "a".repeat(40), transition, notify: () => {}, reload: () => {},
      store: { writeSavedGame: async save => { writes.push(structuredClone(save)); }, writeStartupGame: async () => {} } });
    port = createReliefIslandPort(travel); restored = true;
  }
  if (status.departed) break;
}
if (steps >= 16000) {
  await persist("failed.save.json", travel.attach(await capture()));
  await persist("failed.json", { status: port.statuses(), blocker: travel.archivedReliefBlocker(donorId),
    steps, frozen: transition.frozen(), now: active.simulation.gameNow(), writes: writes.length });
}
assert(steps < 16000, "Automatic filed-island native ship finishes without visiting it");
assert(restored, "Full reload boundary retains paid departing custody");
const final = travel.attach(await capture());
let filed = final.archipelago!.home!;
if (colonyDonor) filed = final.archipelago!.colonies[0]!.save!;
const proof = archivedIslandProof(filed)!;
assert.equal(port.statuses()[0]!.stage, "ready-to-claim");
assert.equal(port.statuses()[0]!.loaded, quest.amount);
assert.equal(final.archipelago!.active, colonyDonor ? null : 2);
assert.equal(active.simulation.resourceTotal(quest.ware), activeBefore);
assert.equal(proof.coverage.to, filed.savedAt);
assert(proof.intervals.length > 2);
await persist("end.save.json", final);
await persist("contexts.save.json", contexts);
await persist("proof.json", proof);
await persist("input.json", { base: toSaveSnapshot(baseline), end: toSaveSnapshot(final),
  proof: { ...proof, intervals: proof.intervals.map((interval, index) => ({ ...interval, baseRevision: index ? null : 1 })) } });
const report = { scope: `Authored finite ${colonyDonor ? "conquered colony donor with native economy cursor" : "home donor plus actual separate colony fixture"}; automatic serial native collection, full departing reload, exact proof retained. No native GPU or server trust claim.`,
  steps, restored, status: port.statuses()[0], coverage: proof.coverage, intervals: proof.intervals.length,
  activeWareBefore: activeBefore, activeWareAfter: active.simulation.resourceTotal(quest.ware), writes: writes.length };
await persist("report.json", report); console.log(JSON.stringify(report));
travel.dispose();
