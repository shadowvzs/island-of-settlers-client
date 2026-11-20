import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { MapBase,MapBases } from "../../../island-of-settlers-shared/src/save-map-delta";
import { createIdentityClient } from "../../src/app/account/identity-client";
import { encodeSnapshotBody } from "../../src/app/save-store/captured-game";
import { createLocalSaveStore } from "../../src/app/save-store/local-save-store";
import { createRemoteSaveStore } from "../../src/app/save-store/remote-save-store";
import { createSaveApiClient } from "../../src/app/save-store/save-api-client";
import { openLocalStorageGame } from "../../src/app/settlement/game-local-storage";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { clearSaveStageProfile, readSaveStageProfile } from "../../src/shared/settlement/save-stage-profile";
import { createMemoryStorage } from "../../tests/memory-storage";
import { resourcesPath } from "./resources-path";
import { toggleFirstFogCell } from "./save-fog-toggle";

/**
 * SAVE-ATTR-01 cloud attribution: a disposable real API/PostgreSQL stack measures the
 * `save.cloud.upload`, `save.cloud.read`, `save.cloud.clearRecovery` and `save.encode` stages.
 * This is application-side HTTP attribution, not browser frame timings.
 *
 * Usage: npx tsx tools/bench/save-cloud-stage-review.ts [save.json]
 */
const fixtureFile = process.argv[2] ??
  resolve(import.meta.dirname, "../../../resources/offline-economy/current-v2-2026-10-29/input.json");
const fixtureBytes = readFileSync(fixtureFile);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as GameSaveV1;
if (fixture.format !== "island-settlers-game" || fixture.version !== 4)
  throw new Error("Supply a current version-2 game save");
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const stack = await startAcceptanceStack();
const flag = globalThis as { __saveStageProfile?: boolean };

const percentile = (sorted: number[], fraction: number) => sorted[Math.min(sorted.length - 1,
  Math.floor(sorted.length * fraction))] ?? 0;
const round = (value: number) => Math.round(value * 100) / 100;
const stats = (samples: readonly { name: string; ms: number }[]) => {
  const byName = new Map<string, number[]>();
  for (const sample of samples) {
    const list = byName.get(sample.name) ?? [];
    list.push(sample.ms);
    byName.set(sample.name, list);
  }
  return Object.fromEntries([...byName].map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [name, { count: values.length, p50: round(percentile(sorted, .5)),
      p95: round(percentile(sorted, .95)), max: round(sorted.at(-1) ?? 0) }];
  }));
};
const measured = async <T>(operation: () => Promise<T>, into: { name: string; ms: number }[]) => {
  clearSaveStageProfile();
  const value = await operation();
  into.push(...readSaveStageProfile());
  return value;
};

const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
const suffix = randomBytes(6).toString("hex");
const credentials = { displayName: `saveattr${suffix}`, email: `${suffix}@example.test`,
  nation: "roman" as const, password: randomBytes(24).toString("base64url") };
let store: ReturnType<typeof createRemoteSaveStore> | undefined;
try {
  if (!(await identity.register(credentials)).ok) throw new Error("Could not register the cloud fixture account");
  const api = createSaveApiClient({ apiUrl: stack.apiUrl, getAccessToken: identity.accessToken });
  const slot = await api.createSlot(1, "SAVE-ATTR cloud stages");
  if (!slot.ok) throw new Error("Could not create the cloud fixture slot");
  const lease = await api.acquireLease(false);
  if (!lease.ok) throw new Error("Could not acquire the cloud fixture lease");
  store = createRemoteSaveStore({
    api, leaseId: () => lease.lease.leaseId, onStatus: () => {},
    slotId: slot.slot.id,
    local: createLocalSaveStore(openLocalStorageGame(createMemoryStorage()), `save-attr:${slot.slot.id}`)
  });
  // An empty slot has no revision until the client reads it; this call is setup, not a sample.
  await store.readSavedGame();
  flag.__saveStageProfile = true;
  const firstWrite: { name: string; ms: number }[] = [];
  const read: { name: string; ms: number }[] = [];
  const repeatWrite: { name: string; ms: number }[] = [];
  for (let round = 0; round < 3; round++)
    await measured(() => store!.writeSavedGame({ ...fixture, savedAt: fixture.savedAt + round }), firstWrite);
  for (let round = 0; round < 3; round++) await measured(() => store!.readSavedGame(), read);
  for (let round = 0; round < 3; round++) {
    const changed = structuredClone(fixture);
    changed.savedAt += 100 + round;
    toggleFirstFogCell(changed);
    await measured(() => store!.writeSavedGame(changed), repeatWrite);
  }
  // In-memory base store: the first round writes the base, later rounds exercise the compact delta.
  const storedBases = new Map<string, MapBase>();
  const bases: MapBases = {
    find: async key => storedBases.get(key) ?? null,
    read: async hash => [...storedBases.values()].find(base => base.hash === hash)?.map ?? null,
    write: async (key, base) => { storedBases.set(key, base); }
  };
  const codec: { name: string; ms: number }[] = [];
  for (let round = 0; round < 3; round++) {
    const changed = structuredClone(fixture);
    changed.savedAt += 200 + round;
    toggleFirstFogCell(changed);
    await measured(async () => { await encodeSnapshotBody(changed, undefined, bases); }, codec);
  }
  flag.__saveStageProfile = false;
  const receipt = {
    generatedAt: new Date().toISOString(),
    tool: "island-of-settlers-client/tools/bench/save-cloud-stage-review.ts",
    fixture: { path: fixtureFile, sha256: createHash("sha256").update(fixtureBytes).digest("hex"),
      bytes: fixtureBytes.length },
    scope: "Disposable local API + PostgreSQL; in-memory map bases; application codec/HTTP stages only; no browser or frame tail; 3 rounds per stage",
    rounds: { firstWrite: stats(firstWrite), read: stats(read), repeatWrite: stats(repeatWrite),
      codecWithBases: stats(codec) },
    checks: {
      readMatchesWritten: (await store.readSavedGame()) !== null,
      revisionAfterWrites: store.revision()
    },
    limits: ["The browser worker compose/round-trip is measured separately by save-hitch-review.ts",
      "These are application-side HTTP timings on one host, not production network capacity"]
  };
  writeFileSync(resolve(output, "save-cloud-stage.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  flag.__saveStageProfile = false;
  store?.stop();
  await identity.logout().catch(() => undefined);
  await stack.close();
}
