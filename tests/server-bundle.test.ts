import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { fromSaveSnapshot, toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { expireSnapshotColonies } from "../src/app/settlement/server-bundle";
import type { ColonyRecord } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { completeGame } from "./save-fixtures";

/** The home island on screen with conquered colony 2 filed (no save of its own yet). */
const homeWithColony = (conqueredAt: number): GameSaveV1 => {
  const game = completeGame();
  const colony = { expeditionId: 2, island: { name: "Gull Rock", voyageSeconds: 120 }, status: "conquered",
    conqueredAt } as unknown as ColonyRecord;
  return { ...game.archipelago!.home!, archipelago: { active: null, colonies: [colony], version: 1 },
    player: game.player };
};

describe("server game bundle: colony expiry timer", () => {
  it("ends a colony past its lifetime on the stored snapshot only", () => {
    const now = COLONY_LIFETIME_MS + 1000;
    expect(expireSnapshotColonies(toSaveSnapshot(homeWithColony(1000)), now - 1)).toBeNull();
    const expired = expireSnapshotColonies(toSaveSnapshot(homeWithColony(1000)), now)!;
    const game = fromSaveSnapshot(expired)!;
    expect(game.archipelago?.colonies).toEqual([]);
    expect(game.archipelago?.evacuations?.map(entry => [entry.expeditionId, entry.deadline])).toEqual([[2, now]]);
    expect(game.player?.experience).toBe(10);
  });
});
