import { describe, expect, it, vi } from "vitest";

import { createSessionClock } from "../src/app/cloud/session-clock";
import { createLeaseKeeper } from "../src/app/cloud/session-lease";
import { createPlayerSession } from "../src/app/settlement/player-session";

const SERVER_TIME = "2026-12-13T10:33:11Z";

describe("session clock", () => {
  it("runs a signed-in player's time from the server's UTC time, whatever the device clock says", () => {
    let monotonic = 5_000, device = Date.UTC(2031, 0, 1);
    const clock = createSessionClock(SERVER_TIME, () => monotonic, () => device);
    expect(clock()).toBe(Date.parse(SERVER_TIME));
    monotonic += 1_500;
    device -= 86_400_000 * 400;
    expect(clock()).toBe(Date.parse(SERVER_TIME) + 1_500);
  });

  it("keeps a signed-in player's quest day on server time after the device clock changes", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 11, 13, 10) });
    try {
      let monotonic = 0;
      const clock = createSessionClock(SERVER_TIME, () => monotonic);
      const session = createPlayerSession({ now: clock, seed: 3 });
      expect(session.progress().questDay).toBe("2026-12-13");
      vi.setSystemTime(Date.UTC(2027, 5, 1));
      monotonic += 60_000;
      expect(clock()).toBe(Date.parse(SERVER_TIME) + 60_000);
      expect(session.progress().questDay).toBe("2026-12-13");
    } finally { vi.useRealTimers(); }
  });

  it("uses device time for guests and an unreadable server time", () => {
    const device = () => 42;
    expect(createSessionClock(undefined, () => 0, device)).toBe(device);
    expect(createSessionClock("not a time", () => 0, device)).toBe(device);
  });

  it("keeps the server time of the acquired lease", async () => {
    const lease = { expiresAt: "2026-12-13T10:34:41Z", leaseId: "lease", serverTime: SERVER_TIME, ttlSeconds: 90 };
    const keeper = createLeaseKeeper({ api: { acquireLease: vi.fn(async () => ({ lease, ok: true as const })),
      releaseLease: vi.fn(async () => undefined), renewLease: vi.fn() }, onLost: vi.fn(),
    timers: { clear: () => undefined, set: () => 0 as never } });
    expect(keeper.serverTime()).toBeUndefined();
    expect(await keeper.acquire(false)).toBe("acquired");
    expect(keeper.serverTime()).toBe(SERVER_TIME);
  });
});
