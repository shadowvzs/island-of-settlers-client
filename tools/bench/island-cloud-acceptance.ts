/** Real HTTP/JWKS/lease/revision/compact-map custody on a fresh disposable PostgreSQL cluster. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";

import { createIdentityClient } from "../../src/app/account/identity-client";
import { createIslandHandoffStore } from "../../src/app/island-handoff-store";
import { createLocalSaveStore } from "../../src/app/save-store/local-save-store";
import { createRemoteSaveStore, SaveConflictError, SessionTakenOverError } from "../../src/app/save-store/remote-save-store";
import { createSaveApiClient } from "../../src/app/save-store/save-api-client";
import { toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { SessionTransitionReloadRequired } from "../../src/app/session-lifecycle";
import { openLocalStorageGame } from "../../src/app/settlement/game-local-storage";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createMemoryStorage } from "../../tests/memory-storage";
import { toggleFirstFogCell } from "./save-fog-toggle";

const output = resolve(process.env.OUTPUT ?? "../resources/project-reviews/island-lifecycle-2026-10-29");
const fixture: GameSaveV1 = JSON.parse(readFileSync(resolve(output, "generated-colony.json"), "utf8"));
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const stack = await startAcceptanceStack();
const suffix = randomBytes(6).toString("hex");
const credentials = { displayName: `review${suffix}`, email: `${suffix}@example.test`, nation: "roman" as const,
  password: randomBytes(24).toString("base64url") };
const checks: string[] = [];
const timings: { name: string; ms: number }[] = [];
const stores: ReturnType<typeof createRemoteSaveStore>[] = [];
const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
const timed = async <T>(name: string, run: () => Promise<T>) => {
  const start = performance.now();
  try { return await run(); } finally { timings.push({ name, ms: performance.now() - start }); }
};
const normalize = async (value: unknown): Promise<unknown> => {
  if (Array.isArray(value)) return Promise.all(value.map(normalize));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(await Promise.all(Object.entries(value).filter(([, item]) => item !== undefined)
    .map(async ([key, item]) => [key, key === "map" && typeof item === "string"
      ? createHash("sha256").update(Buffer.from(item, "base64").subarray(0, 8))
        .update(gunzipSync(Buffer.from(item, "base64").subarray(8))).digest("hex") : await normalize(item)])));
};
const firstDifference = (actual: any, expected: any, path = "game"): string => {
  if (isDeepStrictEqual(actual, expected)) return "";
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object")
    return `${path}: ${String(actual).slice(0, 90)} != ${String(expected).slice(0, 90)}`;
  for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
    const difference = firstDifference(actual[key], expected[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return path;
};
const sameGame = async (actual: unknown, expected: unknown) => {
  assert(actual && expected);
  const difference = firstDifference(await normalize(toSaveSnapshot(actual as GameSaveV1)),
    await normalize(toSaveSnapshot(expected as GameSaveV1)));
  assert.equal(difference, "");
};
try {
  assert.equal((await identity.register(credentials)).ok, true);
  const api = createSaveApiClient({ apiUrl: stack.apiUrl, getAccessToken: identity.accessToken });
  const slot = await api.createSlot(1, "Isolated acceptance");
  assert(slot.ok);
  const lease = await api.acquireLease(false);
  assert(lease.ok);
  let offline = false;
  const transport = createSaveApiClient({ apiUrl: stack.apiUrl, getAccessToken: identity.accessToken,
    fetch: async (...args) => {
      if (offline) throw new TypeError("Injected network interruption");
      return fetch(...args);
    } });
  const makeStore = (client = api, leaseId = lease.lease.leaseId) => {
    const local = createLocalSaveStore(openLocalStorageGame(createMemoryStorage()), `review:${slot.slot.id}`);
    const store = createRemoteSaveStore({ api: client, slotId: slot.slot.id, local,
      leaseId: () => leaseId, onStatus: () => {} });
    stores.push(store);
    return { local, store };
  };
  const first = makeStore(transport);
  assert.equal(await first.store.readSavedGame(), null);
  await timed("initial-two-island-upload", () => first.store.writeSavedGame(fixture));
  await sameGame(await timed("cloud-read-expand", () => makeStore().store.readSavedGame()), fixture);
  checks.push("Exact current-format home/colony snapshot round trip through HTTP and PostgreSQL");
  const changed = structuredClone(fixture);
  changed.savedAt += 1;
  toggleFirstFogCell(changed);
  await timed("delta-upload", () => first.store.writeSavedGame(changed));
  await sameGame(await makeStore().store.readSavedGame(), changed);
  assert.equal(first.store.revision(), 2);
  const bases = await stack.pool.query("SELECT count(*)::int AS count FROM game.save_map_bases WHERE slot_id=$1", [slot.slot.id]);
  assert.equal(bases.rows[0].count, 2);
  checks.push("Two immutable map bases reused; changed fog and all unchanged fields round trip exactly");
  const stale = makeStore();
  await stale.store.readSavedGame();
  await first.store.writeSavedGame({ ...changed, savedAt: changed.savedAt + 1 });
  const handoff = createIslandHandoffStore(stale.store);
  await assert.rejects(handoff.commit(changed), SessionTransitionReloadRequired);
  await sameGame(JSON.parse((await stale.local.readStartupGame())!), changed);
  checks.push("Revision conflict after destination commit preserves durable startup recovery and requires reload");
  const pending = makeStore(transport);
  await pending.store.readSavedGame();
  offline = true;
  await pending.store.writeSavedGame(changed);
  await sameGame(await pending.local.readSavedGame(), changed);
  offline = false;
  await new Promise(resolve => setTimeout(resolve, 2500));
  await pending.store.whenIdle();
  assert.equal(await pending.local.readSavedGame(), null);
  await sameGame(await makeStore().store.readSavedGame(), changed);
  checks.push("Offline upload remains local, retries through actual API, clears only after confirmation");
  await assert.rejects(stale.store.writeSavedGame(changed), SaveConflictError);
  const second = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
  assert.equal((await second.login({ email: credentials.email, password: credentials.password })).ok, true);
  const secondApi = createSaveApiClient({ apiUrl: stack.apiUrl, getAccessToken: second.accessToken });
  assert.deepEqual(await secondApi.acquireLease(false), { ok: false, reason: "held" });
  const taken = await secondApi.acquireLease(true);
  assert(taken.ok);
  await assert.rejects(first.store.writeSavedGame(changed), SessionTakenOverError);
  assert.deepEqual(await api.renewLease(lease.lease.leaseId), { ok: false, reason: "lost" });
  const winner = makeStore(secondApi, taken.lease.leaseId);
  await winner.store.readSavedGame();
  await winner.store.writeSavedGame(changed);
  await sameGame(await makeStore(secondApi, taken.lease.leaseId).store.readSavedGame(), changed);
  checks.push("Second identity session must take lease explicitly; old owner cannot write or renew");
  await secondApi.releaseLease(taken.lease.leaseId);
  await second.logout();
  const result = { checks, timings, immutableBases: bases.rows[0].count,
    scope: "Real services/auth/database; owner database role; upload rate limits, verifier and background catch-up disabled; no browser or replay proof" };
  writeFileSync(resolve(output, "cloud-http.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  for (const store of stores) store.stop();
  await identity.logout().catch(() => {});
  await stack.close();
}
