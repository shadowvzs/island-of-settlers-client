import { describe, expect, it } from "vitest";

import {
  addColonyRecord, colonySurvivors, emptyArchipelago, endColony, expiredColonies, isColonyVisitRequest, travelTo,
  updateColonyStatus, validateArchipelago
} from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

const island = { difficulty: "easy" as const, id: 2, name: "Gull Rock", ore: "coal" as const, seed: 9, voyageSeconds: 120 };
const landing = { crew: 2, landed: { planks: 20 }, troops: [{ hp: 125, rank: 0, type: "shield" as const }] };
const save = (name: string) => ({ format: "island-settlers-game", map: name, version: 1 }) as unknown as GameSaveV1;

describe("archipelago travel", () => {
  it("registers a landed colony once", () => {
    const once = addColonyRecord(emptyArchipelago(), 1, island, landing);
    expect(addColonyRecord(once, 1, island, landing)).toBe(once);
    expect(once.colonies).toHaveLength(1);
    expect(validateArchipelago(once)).toBeNull();
  });

  it("files home and requests a generated colony on the first visit", () => {
    const group = addColonyRecord(emptyArchipelago(), 1, island, landing);
    const payload = travelTo(group, save("home"), 1);
    expect(isColonyVisitRequest(payload)).toBe(true);
    const archipelago = (payload as { archipelago: typeof group }).archipelago;
    expect(archipelago).toMatchObject({ active: 1, home: { map: "home" } });
    expect(validateArchipelago(archipelago)).toBeNull();
  });

  it("returns home with the colony filed, then revisits the saved colony", () => {
    const group = { ...addColonyRecord(emptyArchipelago(), 1, island, landing), active: 1, home: save("home") };
    const conquered = updateColonyStatus(group, 1, "conquered", 1000);
    const home = travelTo(conquered, save("colony"), null) as GameSaveV1;
    expect(home.map).toBe("home");
    expect(home.archipelago).toMatchObject({ active: null, home: undefined });
    expect(home.archipelago!.colonies[0]).toMatchObject({ conqueredAt: 1000, landing: undefined,
      save: { map: "colony" }, status: "conquered" });
    const colony = travelTo(home.archipelago!, save("home again"), 1) as GameSaveV1;
    expect(colony.map).toBe("colony");
    expect(colony.archipelago).toMatchObject({ active: 1, home: { map: "home again" } });
    expect(colony.archipelago!.colonies[0]!.save).toBeUndefined();
  });

  it("ends a colony: releases its slot, brings living soldiers home and expires after 14 days", () => {
    const colonySave = { ...save("colony"), settlement: { military: { soldiers: [
      { actor: 1, building: -1, rank: 2, stationed: false, combat: { cooldown: 0, faction: 0, hp: 80, type: "archer" } },
      { actor: 2, building: 4, rank: 0, stationed: true, combat: { cooldown: 0, faction: 1, hp: 90, type: "heavy" } }
    ] } } } as unknown as GameSaveV1;
    expect(colonySurvivors(colonySave)).toEqual([{ hp: 80, rank: 2, type: "archer" }]);
    const group = updateColonyStatus(addColonyRecord(emptyArchipelago(), 1, island, landing), 1, "conquered", 1000);
    const day = 24 * 60 * 60 * 1000;
    expect(expiredColonies(group, 1000 + 13 * day)).toHaveLength(0);
    expect(expiredColonies(group, 1000 + 14 * day)).toHaveLength(1);
    const ended = endColony(group, 1, colonySurvivors(colonySave));
    expect(ended).toMatchObject({ colonies: [], released: [1], returning: [{ type: "archer" }] });
  });

  it("rejects malformed groups", () => {
    expect(validateArchipelago({ active: 5, colonies: [], version: 1 })).toMatch(/missing/);
    expect(validateArchipelago({ active: null, colonies: [{}], version: 1 })).toMatch(/record/);
    expect(validateArchipelago(undefined)).toBeNull();
  });
});
