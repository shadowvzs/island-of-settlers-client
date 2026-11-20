import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import {
  advanceOfflineGame, offlineSeconds, skipOfflineProgress
} from "../src/app/settlement/offline-progress";
import type { ColonyRecord } from "../src/shared/settlement/archipelago";
import { completeGame } from "./save-fixtures";

const HOUR = 3_600_000;

const colony = (
  expeditionId: number, name: string, now: number, conqueredAt: number
): ColonyRecord => ({
  conqueredAt,
  expeditionId,
  island: { name } as ColonyRecord["island"],
  nextOreShipAt: now - 1_000,
  save: { ...completeGame(), archipelago: undefined, savedAt: now - 6 * HOUR },
  status: "conquered"
});

describe("offline skip (D15)", () => {
  it("moves every replay cursor to now without replaying production", async () => {
    const source = completeGame();
    const now = source.savedAt + 6 * HOUR;
    const result = skipOfflineProgress(source, now);

    expect(result.awaySeconds).toBe(6 * 3_600);
    expect(result.endedColonies).toEqual([]);
    expect(result.save.savedAt).toBe(now);
    expect(result.save.settlement).toEqual(source.settlement);
    expect(result.save.player).toEqual(source.player);
    expect(source.savedAt).toBe(50);

    const group = result.save.archipelago!;
    expect(group.home?.savedAt).toBe(now);
    expect(group.adventures?.[0]?.save?.savedAt).toBe(now);
    await expect(advanceOfflineGame(result.save, now)).resolves.toBe(result.save);
    expect(offlineSeconds(group.home!.savedAt, now)).toBe(0);
  });

  it("ages colony deadlines, moves missed ore ships and keeps the skipped interval out of later visits", () => {
    const now = 30 * 24 * HOUR;
    const source = completeGame();
    source.savedAt = now - 6 * HOUR;
    source.archipelago!.active = null;
    delete source.archipelago!.evacuations;
    delete source.archipelago!.home;
    source.archipelago!.colonies = [
      colony(2, "Old Colony", now, now - COLONY_LIFETIME_MS - 1),
      colony(3, "Young Colony", now, now - 1_000)
    ];

    const result = skipOfflineProgress(source, now);
    const group = result.save.archipelago!;

    expect(result.endedColonies).toEqual(["Old Colony"]);
    expect(group.colonies.map(entry => entry.expeditionId)).toEqual([3]);
    expect(group.colonies[0]?.nextOreShipAt).toBe(now - 1_000 + 6 * HOUR);
    expect(group.evacuations?.[0]).toMatchObject({ deadline: now, name: "Old Colony" });
    expect(group.colonies[0]?.save?.savedAt).toBe(now);
  });

  it("does not touch the clock when no time passed", () => {
    const source = completeGame();
    const result = skipOfflineProgress(source, source.savedAt);
    expect(result).toEqual({ awaySeconds: 0, endedColonies: [], save: source });
  });
});
