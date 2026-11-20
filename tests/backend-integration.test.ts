import { createEconomyCatalog } from "@shared/catalog/balance";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIdentityClient, type IdentityClient } from "../src/app/account/identity-client";
import { createEconomyClient } from "../src/app/cloud/economy-client";
import { dailyQuestClaimBody } from "../src/app/cloud/quest-claim-body";
import { createLeaseKeeper } from "../src/app/cloud/session-lease";
import { createLocalSaveStore } from "../src/app/save-store/local-save-store";
import {
  createRemoteSaveStore, SaveConflictError, SessionTakenOverError
} from "../src/app/save-store/remote-save-store";
import { createSaveApiClient, type SaveApiClient } from "../src/app/save-store/save-api-client";
import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createMemoryStorage } from "./memory-storage";
import { completeGame } from "./save-fixtures";

/**
 * The browser client's account and cloud save path against the live local stack (docs/server/local-dev.md):
 * `npm run stack --prefix island-of-settlers-local-dev`, then `BACKEND_INTEGRATION=1 npx vitest run tests/backend-integration.test.ts`.
 * Skipped otherwise. One fresh account per run (identity allows 5 registrations per IP and hour).
 */
const enabled = process.env.BACKEND_INTEGRATION === "1";
const IDENTITY = process.env.DEV_IDENTITY_URL ?? "http://127.0.0.1:3001";
const API = process.env.DEV_API_URL ?? "http://127.0.0.1:3002";
const suffix = randomBytes(5).toString("hex");
const ACCOUNT = { displayName: `it${suffix}`, email: `it-${suffix}@example.test`, nation: "roman" as const,
  password: `integration-${randomBytes(9).toString("base64url")}` };

/** One "device": its own identity session, API client and session lease. */
const device = async (register = false) => {
  const identity = createIdentityClient({ identityUrl: IDENTITY, lock: run => run() });
  const result = register ? await identity.register(ACCOUNT)
    : await identity.login({ email: ACCOUNT.email, password: ACCOUNT.password });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  const api = createSaveApiClient({ apiUrl: API, getAccessToken: identity.accessToken,
    renewAccessToken: identity.renew });
  const lost: string[] = [];
  return { api, identity, lease: createLeaseKeeper({ api, onLost: () => lost.push("lost") }), lost };
};

/** A cloud store of `slotId` for one device (its own recovery copy in memory). */
const cloudStore = (api: SaveApiClient, slotId: string, leaseId: () => string | undefined) => {
  const local = createLocalSaveStore(openLocalStorageGame(createMemoryStorage()), `cloud-recovery:it:${slotId}`);
  return createRemoteSaveStore({ api, leaseId, local, onStatus: () => undefined, slotId });
};

/**
 * A save with a realistic map document (hundreds of KB of base64): it must stay out of the metadata. No gems:
 * the ledger decides those.
 */
const game = (experience: number): GameSaveV1 =>
  ({ ...completeGame(), map: "A".repeat(400_000), player: { ...completeGame().player!, experience, gems: 0 } });

describe.skipIf(!enabled)("accounts and cloud saves against the local stack", () => {
  let first: Awaited<ReturnType<typeof device>>, slotId = "";
  let firstIdentity: IdentityClient;

  beforeAll(async () => {
    first = await device(true);
    firstIdentity = first.identity;
    const created = await first.api.createSlot(1, "Slot 1");
    if (!created.ok) throw new Error("slot 1 exists");
    slotId = created.slot.id;
  });

  afterAll(async () => {
    if (!enabled || !firstIdentity) return;
    await fetch(`${IDENTITY}/v1/account`, { body: JSON.stringify({ password: ACCOUNT.password }),
      headers: { Authorization: `Bearer ${await firstIdentity.accessToken()}`, "Content-Type": "application/json" },
      method: "DELETE" });
  });

  it("registers, plays, saves gzip snapshots under the lease, reloads and loads the same game", async () => {
    expect(await first.lease.acquire(false)).toBe("acquired");
    const store = cloudStore(first.api, slotId, first.lease.id);
    expect(await store.readSavedGame()).toBeNull();
    await store.writeSavedGame(game(11));
    await store.writeSavedGame(game(12));
    expect(store.revision()).toBe(2);
    const reloaded = cloudStore(first.api, slotId, first.lease.id);
    expect(await reloaded.readSavedGame()).toEqual(game(12));
    const history = await fetch(`${API}/v1/saves/${slotId}/history`,
      { headers: { Authorization: `Bearer ${await first.identity.accessToken()}` } });
    expect((await history.json() as { revision: number }[]).map(row => row.revision)).toEqual([2, 1]);
  });

  it("refuses a stale tab with a conflict until it overwrites", async () => {
    const tabA = cloudStore(first.api, slotId, first.lease.id), tabB = cloudStore(first.api, slotId, first.lease.id);
    await tabA.readSavedGame();
    await tabB.readSavedGame();
    await tabB.writeSavedGame(game(20));
    await expect(tabA.writeSavedGame(game(21))).rejects.toBeInstanceOf(SaveConflictError);
    await tabA.overwrite();
    expect(await cloudStore(first.api, slotId, first.lease.id).readSavedGame()).toEqual(game(21));
  });

  it("caps unverified level claims, pays quest and adventure rewards once, and rejects a forged snapshot", async () => {
    const economy = createEconomyClient({ apiUrl: API, getAccessToken: first.identity.accessToken });
    const catalog = createEconomyCatalog();
    // No verifier bundle runs in the local stack, so the slot has no verified XP: the request's level is
    // only a ceiling and the claim pays nothing. A later verified revision is covered by the client unit tests.
    const earned = await economy.claimLevels(40);
    expect(earned.wallet.gems).toBe(0);
    expect((await economy.claimLevels(40)).paid).toEqual([]);
    const day = new Date().toISOString().slice(0, 10);
    // The same verified-level cap applies to quest goods: no verified revision means level 1 rewards.
    const material = catalog.questMaterial[0]!, coins = catalog.questCoins.base + catalog.questCoins.perLevel;
    const quest = dailyQuestClaimBody({ bonus: 0, material: "stone", questId: `${day}-0` }, Date.now());
    const paid = { coins, goods: { coins, [material.stone]: material.amount }, ok: true };
    expect(await economy.claimQuest(quest)).toMatchObject({ ...paid, repeated: false });
    expect(await economy.claimQuest(quest)).toMatchObject({ ...paid, repeated: true });
    const adventure = { adventureId: 9, bonus: 1, difficulty: "hard", seed: 4 };
    const loot = await economy.claimAdventure(adventure);
    expect(loot).toMatchObject({ ok: true });
    expect(loot.ok && loot.goods.coins).toBe(Math.round(catalog.adventureLoot.hard.coins *
      (1 + catalog.talentBonusMax.adventureLoot)));
    expect(await economy.claimAdventure(adventure)).toMatchObject({ goods: {}, ok: true });
    const store = cloudStore(first.api, slotId, first.lease.id);
    await store.readSavedGame();
    const honest = game(0);
    await store.writeSavedGame({ ...honest, player: { ...honest.player!, gems: 0 } });
    await expect(store.writeSavedGame({ ...honest, player: { ...honest.player!, gems: 1000 } }))
      .rejects.toMatchObject({ code: "SAVE_REJECTED", status: 422 });
  });

  it("hands the session to a second device only on take-over; the first then stops saving", async () => {
    const second = await device();
    expect(await second.lease.acquire(false)).toBe("held");
    expect(await second.lease.acquire(true)).toBe("acquired");
    const stale = cloudStore(first.api, slotId, first.lease.id);
    await stale.readSavedGame();
    await expect(stale.writeSavedGame(game(30))).rejects.toBeInstanceOf(SessionTakenOverError);
    const renewed = await first.api.renewLease(first.lease.id()!);
    expect(renewed).toEqual({ ok: false, reason: "lost" });
    const active = cloudStore(second.api, slotId, second.lease.id);
    await active.readSavedGame();
    await active.writeSavedGame(game(31));
    expect(await cloudStore(second.api, slotId, second.lease.id).readSavedGame()).toEqual(game(31));
    await second.lease.release();
    await second.identity.logout();
  });
});
