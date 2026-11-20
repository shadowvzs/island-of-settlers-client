import { describe, expect, it, vi } from "vitest";

import { createLevelReclaimer, createVerificationStatus } from "../src/app/cloud/verification-status";
import { createSaveApiClient, type SaveVerification } from "../src/app/save-store/save-api-client";
import { createPlayerSession } from "../src/app/settlement/player-session";

const API = "https://api.example.test";
const SLOT = "5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const verification = (verifiedRevision: number | null,
  flag: Record<string, unknown> | null = null): SaveVerification =>
  ({ flag, flaggedAt: flag ? "2026-10-23T10:00:00.000Z" : null, randomTrailRequest: null, verifiedRevision });

describe("verification status", () => {
  it("reads the slot's verified revision, flag and pending trail request through the typed save client", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url.slice(API.length)}`);
      return json({ flag: { plausibility: { violations: [] } }, flaggedAt: "2026-10-23T10:00:00.000Z",
        randomTrailRequest: { endTick: 140, island: "home", revision: 3 }, verifiedRevision: 2 });
    }) as unknown as typeof globalThis.fetch;
    const client = createSaveApiClient({ apiUrl: API, fetch, getAccessToken: async () => "token" });
    expect(await client.readVerification(SLOT)).toEqual({ flag: { plausibility: { violations: [] } },
      flaggedAt: "2026-10-23T10:00:00.000Z", randomTrailRequest: { endTick: 140, island: "home", revision: 3 },
      verifiedRevision: 2 });
    expect(calls).toEqual([`GET /v1/saves/${SLOT}/verification`]);
  });

  const setup = (answers: SaveVerification[], revision = 4) => {
    const readVerification = vi.fn(async () => answers.shift() ?? verification(revision));
    const status = createVerificationStatus({ api: { readVerification }, retryDelays: [0],
      revision: () => revision, slotId: SLOT });
    const claimLevel = vi.fn();
    const reclaimer = createLevelReclaimer({ claimLevel, level: () => 12, status });
    return { claimLevel, readVerification, reclaimer, status };
  };

  it("does not claim before the save carrying the level's XP is verified", async () => {
    const { claimLevel, reclaimer, status } = setup([verification(3), verification(3)]);
    await reclaimer.boot();
    expect(status.status.getSnapshot()).toEqual({ flag: null, flaggedAt: null, revision: 4, pending: true,
      verifiedRevision: 3 });
    await reclaimer.afterUpload();
    expect(claimLevel).not.toHaveBeenCalled();
    expect(status.status.getSnapshot()?.pending).toBe(true);
  });

  it("re-claims the player's level once after verification catches up with the upload", async () => {
    const { claimLevel, reclaimer, status } = setup([verification(3), verification(4)]);
    await reclaimer.boot();
    await reclaimer.afterUpload();
    expect(claimLevel).toHaveBeenCalledTimes(1);
    expect(claimLevel).toHaveBeenCalledWith(12);
    expect(status.status.getSnapshot()).toMatchObject({ pending: false, verifiedRevision: 4 });
  });

  it("does not claim again when repeated status checks see the same verified revision", async () => {
    const { claimLevel, reclaimer } = setup([verification(3), verification(4), verification(4), verification(4)]);
    await reclaimer.boot();
    await reclaimer.afterUpload();
    await reclaimer.afterUpload();
    await reclaimer.afterUpload();
    expect(claimLevel).toHaveBeenCalledTimes(1);
  });

  it("leaves guest play alone: without a server economy a level claim is a no-op", () => {
    const session = createPlayerSession({ now: () => Date.UTC(2026, 9, 23), seed: 3 });
    expect(session.claimServerLevel()).toBeUndefined();
    expect(session.level()).toBe(1);
  });
});
