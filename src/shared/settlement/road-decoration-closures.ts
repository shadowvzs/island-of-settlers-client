import { getRoadDecorationItem } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { isObject } from "../../../../island-of-settlers-shared/src/validation";
import type { PlayerProgress } from "../progression/player-progress";
import type { Archipelago } from "./archipelago";
import type { GameSaveV1 } from "./game-save";

export interface ClosedRoadDecorationReturn {
  island: `colony-${number}` | `adventure-${number}`;
  items: Readonly<Record<string, number>>;
}
const ISLAND = /^(colony|adventure)-[1-9][0-9]{0,9}$/;

export const closedRoadDecorationReturnProblem = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 256) return "Invalid closed road decoration returns";
  const seen = new Set<string>();
  for (const row of value) {
    if (!isObject(row) || typeof row.island !== "string" || !ISLAND.test(row.island) || seen.has(row.island) ||
      Object.keys(row).some(key => key !== "island" && key !== "items") || !isObject(row.items)) return "Invalid closed road decoration return";
    seen.add(row.island);
    const entries = Object.entries(row.items);
    if (!entries.length || entries.length > 256) return "Invalid closed road decoration item set";
    for (const [item, amount] of entries) {
      const definition = getRoadDecorationItem(item);
      if (!definition || !Number.isSafeInteger(amount) || (amount as number) < 1 || (amount as number) > definition.maxHeld)
        return "Invalid closed road decoration item";
    }
  }
  return null;
};

/** Pure discarded-world receipt: the same island closure cannot enqueue its units twice. */
export const queueClosedRoadDecorations = (
  group: Archipelago & { closedRoadDecorations?: readonly ClosedRoadDecorationReturn[] },
  island: ClosedRoadDecorationReturn["island"], source?: GameSaveV1) => {
  const state = source?.settlement.roadDecorations;
  if (!state || group.closedRoadDecorations?.some(row => row.island === island)) return group;
  const items: Record<string, number> = {};
  for (const row of [...state.placed, ...state.returns]) items[row.item] = (items[row.item] ?? 0) + 1;
  if (!Object.keys(items).length) return group;
  return { ...group, closedRoadDecorations: [...group.closedRoadDecorations ?? [], { island, items }] };
};

/** Offline guests receive existing units; signed-in worlds rely exclusively on the server's deletion transaction. */
export const receiveClosedRoadDecorations = (progress: PlayerProgress, rows: readonly ClosedRoadDecorationReturn[], online: boolean) => {
  if (closedRoadDecorationReturnProblem(rows)) return null;
  if (online) return progress;
  const inventory = { ...progress.inventory };
  for (const row of rows) for (const [item, amount] of Object.entries(row.items)) {
    const id = item as keyof typeof inventory, count = (inventory[id] ?? 0) + amount;
    if (!Number.isSafeInteger(count) || count > getRoadDecorationItem(item)!.maxHeld) return null;
    inventory[id] = count;
  }
  return { ...progress, inventory };
};
