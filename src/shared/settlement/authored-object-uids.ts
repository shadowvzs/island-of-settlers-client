import { isScenarioObjectId } from "../world/scenario-object-ids";
import { toMapSceneryUid } from "./map-scenery";
import { isSaveInteger, isSaveObject } from "./save-validation";
import type { SettlementContext } from "./settlement-types";

/**
 * The map start's table map-file object id → runtime uid (ACT1), recorded while the authored objects spawn
 * and saved with the authored scenario progress. Flat `[mapId, uid, ...]` pairs per runtime uid space, in
 * spawn order. Decoration models need no table: the saved scenery rows keep their ids and their row order
 * is their scenery uid.
 */
export interface AuthoredObjectUids {
  /** Field units: actor uids (`context.nextActor`). */
  actor: number[];
  /** Authored buildings and camps: building uids (`context.nextBuilding`). */
  building: number[];
}

export type AuthoredObjectSpace = keyof AuthoredObjectUids | "scenery";

export interface AuthoredObjectHandle {
  space: AuthoredObjectSpace;
  uid: number;
}

/** The bound of each space: the scenario's own limits (512 units, 128 buildings). */
const MAX_PAIRS: Readonly<Record<keyof AuthoredObjectUids, number>> = { actor: 512, building: 128 };

export const createAuthoredObjectUids = (): AuthoredObjectUids => ({ actor: [], building: [] });

const findPair = (pairs: readonly number[], id: number) => {
  for (let index = 0; index < pairs.length; index += 2) {
    if (pairs[index] === id) return pairs[index + 1];
  }
  return undefined;
};

const sceneryHandle = (context: SettlementContext, id: number): AuthoredObjectHandle | undefined => {
  const index = context.roadDecorations?.sceneryRows().findIndex(row => row.id === id) ?? -1;
  if (index < 0) return undefined;
  return { space: "scenery", uid: toMapSceneryUid(index + 1) };
};

/**
 * The runtime handle the map start gave an authored object, or undefined when that object was not spawned
 * (home maps spawn no enemies; a draft spawns nothing). The handle may since be gone (killed, destroyed).
 */
export const findAuthoredObjectHandle = (context: SettlementContext, id: number): AuthoredObjectHandle | undefined => {
  const table = context.authoredScenario?.objects;
  const actor = table && findPair(table.actor, id);
  if (actor !== undefined) return { space: "actor", uid: actor };
  const building = table && findPair(table.building, id);
  if (building !== undefined) return { space: "building", uid: building };
  return sceneryHandle(context, id);
};

const validPairs = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length % 2 !== 0 || value.length > max * 2) return false;
  const ids = new Set<number>();
  for (let index = 0; index < value.length; index += 2) {
    const id = value[index], uid = value[index + 1];
    if (!isScenarioObjectId(id) || ids.has(id) || !isSaveInteger(uid)) return false;
    ids.add(id);
  }
  return true;
};

/** Save validation: absent (maps saved before ACT1 or without authored objects) or well-formed pairs. */
export const validAuthoredObjectUids = (value: unknown) => {
  if (value === undefined) return true;
  if (!isSaveObject(value) || !Object.keys(value).every(key => key in MAX_PAIRS)) return false;
  return validPairs(value.actor, MAX_PAIRS.actor) && validPairs(value.building, MAX_PAIRS.building);
};
