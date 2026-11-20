import {
  isFiniteNumber, isPlainObject, isSafeIntegerFrom, isSafeTree, MAX_SAVE_DEPTH
} from "../../../../island-of-settlers-shared/src/validation/index";
import type { SettlementPoint } from "./settlement-types";

/** Save predicates on the shared validation kit; keep validation independent of live simulation mutations. */
export const isSaveObject = isPlainObject;
export const isSaveInteger = (value: unknown, minimum = 0): value is number => isSafeIntegerFrom(value, minimum);
export const isSavePoint = (value: unknown): value is Record<string, unknown> & SettlementPoint =>
  isSaveObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z);
export const isSaveGoods = (value: unknown) =>
  isSaveObject(value) && Object.values(value).every((count) => isSaveInteger(count));

/**
 * Nesting budgets of the save trees checked with `isSafeTree`. `MAX_SAVE_DEPTH` (shared with the server) counts
 * from the game save root, so a sub-document gets the levels left at its position: the settlement is one level
 * inside the game save, its road decorations two. A bug report is checked from its own root.
 */
export const SAVE_TREE_DEPTH = {
  bugReplay: MAX_SAVE_DEPTH,
  roadDecorations: MAX_SAVE_DEPTH - 2,
  settlement: MAX_SAVE_DEPTH - 1
} as const;

export { isFiniteNumber, isSafeTree };
