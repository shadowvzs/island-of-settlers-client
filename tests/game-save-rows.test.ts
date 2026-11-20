import { describe, expect, it } from "vitest";

import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { addColonyRecord, emptyArchipelago, travelTo } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { composeGameSave, splitGameSave } from "../src/shared/settlement/game-save-rows";

const island = { difficulty: "easy" as const, id: 2, name: "Gull Rock", ore: "coal" as const, seed: 9, voyageSeconds: 120 };
const landing = { crew: 2, landed: {}, troops: [] };
const save = (map: string): GameSaveV1 => ({ format: "island-settlers-game", map, progress: { fog: { length: 0, packed: "" }, surveyed: [] },
  savedAt: 10, settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"], version: 4 });
const player = { ...createPlayerProgress(3), experience: 150, gems: 5 };

describe("game save rows", () => {
  it("stores a single-island save as one island, one player and one session row", () => {
    const rows = splitGameSave({ ...save("home"), player });
    expect(rows.islands.map(row => row.id)).toEqual(["home"]);
    expect(rows.player?.progress).toEqual(player);
    expect(rows.session).toMatchObject({ active: null, savedAt: 10 });
    expect(composeGameSave(rows)).toEqual({ ...save("home"), archipelago: undefined, player });
  });

  it("stores every island once and rebuilds the visited colony with home filed", () => {
    const group = addColonyRecord(emptyArchipelago(), 1, island, landing);
    const atColony = travelTo(group, save("home"), 1) as { archipelago: GameSaveV1["archipelago"] };
    const onColony: GameSaveV1 = { ...save("colony"), archipelago: atColony.archipelago, player };
    const rows = splitGameSave(onColony);
    expect(rows.islands.map(row => row.id).sort()).toEqual(["colony-1", "home"]);
    expect(rows.islands.every(row => row.save.archipelago === undefined && row.save.player === undefined)).toBe(true);
    expect(rows.colonies[0]).not.toHaveProperty("save");
    const rebuilt = composeGameSave(rows)!;
    expect(rebuilt.map).toBe("colony");
    expect(rebuilt.archipelago).toMatchObject({ active: 1, home: { map: "home" } });
    expect(rebuilt.player).toEqual(player);
    expect(splitGameSave(rebuilt)).toEqual(rows);
  });

  it("rebuilds home with the colony's own save filed under its record", () => {
    const group = { ...addColonyRecord(emptyArchipelago(), 1, island, landing), active: 1, home: save("home") };
    const backHome = travelTo(group, save("colony"), null) as GameSaveV1;
    const rebuilt = composeGameSave(splitGameSave(backHome))!;
    expect(rebuilt.map).toBe("home");
    expect(rebuilt.archipelago!.colonies[0]!.save?.map).toBe("colony");
    expect(composeGameSave({ ...splitGameSave(backHome), islands: [] })).toBeNull();
  });
});
