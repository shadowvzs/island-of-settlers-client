import { describe, expect, it } from "vitest";

import {
  createRespawnLedger,
  RESPAWN_SECONDS,
  RESPAWN_TICKS,
  RETRY_TICKS
} from "../src/render-common/wildlife/population/respawn-ledger";

describe("respawn ledger", () => {
  it("owes one entry per missing animal, due five minutes later and not before", () => {
    expect(RESPAWN_SECONDS).toBe(300);
    expect(RESPAWN_TICKS).toBe(6000);
    const ledger = createRespawnLedger();
    ledger.reconcile(2, 3, 1, 100);
    expect(ledger.count()).toBe(2);
    expect(ledger.pending(2)).toBe(2);
    expect(ledger.dueTick(0)).toBe(100 + RESPAWN_TICKS);
    const spawned: number[] = [];
    ledger.resolve(100 + RESPAWN_TICKS - 1, (region) => {
      spawned.push(region);
      return "spawned";
    });
    expect(spawned).toEqual([]);
    ledger.resolve(100 + RESPAWN_TICKS, (region) => {
      spawned.push(region);
      return "spawned";
    });
    expect(spawned).toEqual([2, 2]);
    expect(ledger.count()).toBe(0);
  });

  it("retries a failed placement a little later and drops entries no longer wanted", () => {
    const ledger = createRespawnLedger();
    ledger.schedule(1, 10);
    ledger.schedule(4, 10);
    ledger.resolve(10, (region) => (region === 1 ? "retry" : "drop"));
    expect(ledger.count()).toBe(1);
    expect(ledger.region(0)).toBe(1);
    expect(ledger.dueTick(0)).toBe(10 + RETRY_TICKS);
  });

  it("reconciles to the target: new entries five minutes out, the latest surplus dropped", () => {
    const ledger = createRespawnLedger();
    ledger.schedule(7, 50);
    ledger.schedule(7, 90);
    ledger.schedule(8, 60);
    ledger.reconcile(7, 1, 0, 200);
    expect(ledger.count()).toBe(2);
    expect(ledger.region(0)).toBe(7);
    expect(ledger.dueTick(0)).toBe(50);
    expect(ledger.region(1)).toBe(8);
    ledger.reconcile(7, 3, 0, 200);
    expect(ledger.pending(7)).toBe(3);
    expect(ledger.dueTick(2)).toBe(200 + RESPAWN_TICKS);
    ledger.reconcile(7, 3, 1, 200);
    expect(ledger.pending(7)).toBe(2);
  });

  it("saves and restores its entries in order", () => {
    const ledger = createRespawnLedger();
    ledger.schedule(3, 30);
    ledger.schedule(1, 20);
    const saved = ledger.save();
    expect([...saved.regions]).toEqual([3, 1]);
    expect([...saved.dueTicks]).toEqual([30, 20]);
    const restored = createRespawnLedger();
    restored.load(saved.regions, saved.dueTicks);
    expect(restored.count()).toBe(2);
    expect(restored.region(1)).toBe(1);
    expect(restored.dueTick(0)).toBe(30);
  });

  it("tries at most `limit` due entries per call; the rest stay due for the next call", () => {
    const ledger = createRespawnLedger();
    for (let region = 0; region < 5; region += 1) ledger.schedule(region, 10);
    const tried: number[] = [];
    ledger.resolve(10, (region) => {
      tried.push(region);
      return "retry";
    }, 2);
    expect(tried).toEqual([0, 1]);
    expect([0, 1, 2, 3, 4].map(ledger.dueTick)).toEqual([10 + RETRY_TICKS, 10 + RETRY_TICKS, 10, 10, 10]);
    ledger.resolve(11, (region) => {
      tried.push(region);
      return "spawned";
    }, 2);
    expect(tried).toEqual([0, 1, 2, 3]);
    expect(ledger.count()).toBe(3);
  });
});
