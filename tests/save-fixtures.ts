import { createPlayerProgress } from "../src/shared/progression/player-progress";
import type { AdventureRecord, ColonyRecord } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

/** A bare island save (settlement contents do not matter to the stores). */
const islandSave = (map: string, savedAt = 10): GameSaveV1 => ({
  format: "island-settlers-game", map, progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt,
  settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"], version: 4
});

const islandRecord = (kind: string, expeditionId: number, save?: GameSaveV1) =>
  ({ expeditionId, island: { name: `${kind} ${expeditionId}` }, save, status: "landed" }) as unknown;
const colony = (expeditionId: number) => islandRecord("Colony", expeditionId) as ColonyRecord;
const adventure = (expeditionId: number, save: GameSaveV1) =>
  islandRecord("Adventure", expeditionId, save) as AdventureRecord;

/**
 * Everything a game persists: colony 2 on screen, the home island and adventure 5 filed in the archipelago,
 * one evacuation, rewards, returning troops and player progress.
 */
export const completeGame = (): GameSaveV1 => ({
  ...islandSave("colony-two", 50),
  archipelago: {
    active: 2,
    adventures: [adventure(5, islandSave("adventure-five"))],
    colonies: [colony(2)],
    evacuations: [{ cargo: { stone: 4 }, deadline: 600_000, expeditionId: 3, name: "Gull Rock",
      troops: [{ hp: 100, rank: 1, type: "shield" }], voyageSeconds: 120 }],
    home: islandSave("home-island"),
    released: [7],
    returning: [{ hp: 80, rank: 2, type: "shield" }],
    rewards: { coins: 30 },
    version: 1
  },
  player: { ...createPlayerProgress(1), experience: 10, gems: 42 }
});
