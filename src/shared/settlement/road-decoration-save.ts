import { isRoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { RoadDecorationSave } from "./road-decoration-state";
import { isSafeTree, isSaveObject, SAVE_TREE_DEPTH } from "./save-validation";

export const MAX_ISLAND_ROAD_DECORATIONS = 100_000;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const point = (value: unknown) => isSaveObject(value) && Object.keys(value).every(key => key === "x" || key === "z") &&
  typeof value.x === "number" && typeof value.z === "number" && Number.isFinite(value.x) && Number.isFinite(value.z) &&
  value.x >= 0 && value.z >= 0 && value.x <= 16384 && value.z <= 16384;

/** Strict new-save schema. Private item entitlement is additionally checked by verified custody receipts. */
export const roadDecorationSaveProblem = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (!isSafeTree(value, SAVE_TREE_DEPTH.roadDecorations) || !isSaveObject(value) || !positive(value.nextUid) ||
    !positive(value.nextReturn) ||
    !Array.isArray(value.placed) || !Array.isArray(value.returns) ||
    value.placed.length + value.returns.length > MAX_ISLAND_ROAD_DECORATIONS) return "Invalid road decoration state";
  const uids = new Set<number>(), transfers = new Set<number>(), sources = new Set<number>();
  for (const row of value.placed) {
    if (!isSaveObject(row) || !positive(row.uid) || row.uid >= value.nextUid || uids.has(row.uid) ||
      !isRoadDecorationItemId(row.item) || !point(row.position) ||
      !Number.isFinite(row.yaw) || Math.abs(row.yaw as number) > Math.PI * 2 ||
      Object.keys(row).some(key => !["uid", "item", "position", "yaw"].includes(key)))
      return "Invalid placed road decoration";
    uids.add(row.uid);
  }
  for (const row of value.returns) {
    if (!isSaveObject(row) || !positive(row.id) || row.id >= value.nextReturn || transfers.has(row.id) ||
      !positive(row.source) || row.source >= value.nextUid || uids.has(row.source) || sources.has(row.source) ||
      !isRoadDecorationItemId(row.item) || typeof row.reason !== "string" || row.reason.length > 128)
      return "Invalid road decoration return";
    transfers.add(row.id); sources.add(row.source);
  }
  return null;
};

export const isRoadDecorationSave = (value: unknown): value is RoadDecorationSave =>
  value !== undefined && roadDecorationSaveProblem(value) === null;
