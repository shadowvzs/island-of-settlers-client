import { describe, expect, it } from "vitest";

import { adventureOffers, adventureRewardGoods } from "../src/shared/settlement/adventure-rules";
import {
  addAdventureRecord, addColonyRecord, type Archipelago,
emptyArchipelago, endAdventure, findIsland,   isColonyVisitRequest, islandSurvivors,
travelTo, updateAdventureStatus, validateArchipelago} from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { composeGameSave, splitGameSave } from "../src/shared/settlement/game-save-rows";

const adventure = adventureOffers(9).find(island => island.difficulty === "hard")!;
const colony = { difficulty: "easy" as const, id: 2, name: "Gull Rock", ore: "coal" as const, seed: 9,
  voyageSeconds: 120 };
const troops = [{ hp: 125, rank: 1, type: "heavy" as const }, { hp: 60, rank: 0, type: "archer" as const }];
const landing = { crew: 0, landed: {}, troops };
const save = (map: string): GameSaveV1 => ({ format: "island-settlers-game", map, progress: { fog: { length: 0, packed: "" }, surveyed: [] },
  savedAt: 10, settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"], version: 4 });

describe("adventures in the island group", () => {
  it("registers a landed adventure once, apart from the colony slots", () => {
    const withColony = addColonyRecord(emptyArchipelago(), 1, colony, { ...landing, crew: 2 });
    const group = addAdventureRecord(withColony, 4, adventure, landing);
    expect(addAdventureRecord(group, 4, adventure, landing)).toBe(group);
    expect(group.colonies).toHaveLength(1);
    expect(group.adventures).toHaveLength(1);
    expect(findIsland(group, 4)?.island).toEqual(adventure);
    expect(validateArchipelago(group)).toBeNull();
  });

  it("generates the adventure on the first visit and files it on the way home", () => {
    const group = addAdventureRecord(emptyArchipelago(), 4, adventure, landing);
    const visit = travelTo(group, save("home"), 4);
    expect(isColonyVisitRequest(visit)).toBe(true);
    const abroad = (visit as { archipelago: Archipelago }).archipelago;
    expect(abroad).toMatchObject({ active: 4, home: { map: "home" } });
    expect(validateArchipelago(abroad)).toBeNull();
    const fighting = updateAdventureStatus(abroad, 4, "contested");
    const home = travelTo(fighting, save("adventure"), null) as GameSaveV1;
    expect(home.archipelago!.adventures![0]).toMatchObject({ landing: undefined, save: { map: "adventure" },
      status: "contested" });
    const back = travelTo(home.archipelago!, save("home again"), 4) as GameSaveV1;
    expect(back.map).toBe("adventure");
  });

  it("discards a finished adventure: survivors and the reward sail home, its expedition is released", () => {
    const won = updateAdventureStatus(addAdventureRecord(emptyArchipelago(), 4, adventure, landing), 4, "won");
    const rewards = adventureRewardGoods(adventure);
    const ended = endAdventure({ ...won, rewards: { coins: 5 } }, 4, troops.slice(0, 1), rewards);
    expect(ended.adventures).toBeUndefined();
    expect(ended).toMatchObject({ released: [4], returning: [{ type: "heavy" }] });
    expect(ended.rewards).toEqual({ ...rewards, coins: rewards.coins + 5 });
    expect(validateArchipelago(ended)).toBeNull();
    expect(islandSurvivors({ landing })).toEqual(troops);
  });

  it("stores adventures in their own rows and rebuilds the visited adventure", () => {
    const group = addAdventureRecord(emptyArchipelago(), 4, adventure, landing);
    const abroad = (travelTo(group, save("home"), 4) as { archipelago: Archipelago }).archipelago;
    const onAdventure: GameSaveV1 = { ...save("adventure"), archipelago: { ...abroad, rewards: { coins: 3 } } };
    const rows = splitGameSave(onAdventure);
    expect(rows.islands.map(row => row.id).sort()).toEqual(["adventure-4", "home"]);
    expect(rows.adventures![0]).not.toHaveProperty("save");
    expect(rows.session.rewards).toEqual({ coins: 3 });
    const rebuilt = composeGameSave(rows)!;
    expect(rebuilt.map).toBe("adventure");
    expect(rebuilt.archipelago).toMatchObject({ active: 4, adventures: [{ expeditionId: 4 }], home: { map: "home" } });
    expect(splitGameSave(rebuilt)).toEqual(rows);
  });

  it("rejects malformed adventure records", () => {
    const group = addAdventureRecord(emptyArchipelago(), 4, adventure, landing);
    expect(validateArchipelago({ ...group, adventures: [...group.adventures!, ...group.adventures!] }))
      .toMatch(/adventure list/);
    expect(validateArchipelago({ ...group, adventures: [{ ...group.adventures![0]!, status: "conquered" }] }))
      .toMatch(/adventure record/);
    expect(validateArchipelago({ ...group, rewards: { coins: -1 } })).toMatch(/rewards/);
    expect(validateArchipelago({ ...group, active: 4 })).toBeNull();
  });
});
