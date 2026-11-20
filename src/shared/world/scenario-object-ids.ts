import type { MapScenario, ScenarioPoint } from "./map-scenario";

/**
 * Stable map-file object ids (ACT1). Every authored object of a scenario (field units, buildings and
 * decoration models; later settlers, ships and ambient entries) shares one id space, allocated from the
 * never-decreasing `MapScenario.nextObjectId` counter: a deleted object's id is never handed out again.
 * Scripts and actors reference authored objects only by these ids.
 */
export const MAX_SCENARIO_OBJECT_ID = 1_000_000;

/** The collections that carry map-file object ids, in their deterministic file order. */
export type AuthoredObjectKind = "building" | "decoration" | "unit";

export interface AuthoredObjectRow extends ScenarioPoint {
  id: number;
  kind: AuthoredObjectKind;
}

type ScenarioObjects = Pick<MapScenario, "buildings" | "decorations" | "units">;

/** Every authored object that has an id: units, then buildings, then decoration models (file order). */
export const listAuthoredObjects = (scenario: ScenarioObjects): AuthoredObjectRow[] => {
  const rows: AuthoredObjectRow[] = [];
  for (const { id, x, z } of scenario.units) rows.push({ id, kind: "unit", x, z });
  for (const { id, x, z } of scenario.buildings) rows.push({ id, kind: "building", x, z });
  for (const { id, x, z } of scenario.decorations ?? []) {
    if (id !== undefined) rows.push({ id, kind: "decoration", x, z });
  }
  return rows;
};

/** The authored object with this map-file id, or undefined when the map no longer has it. */
export const findAuthoredObject = (scenario: ScenarioObjects, id: number) =>
  listAuthoredObjects(scenario).find(row => row.id === id);

/** The largest id in use (0 for none). */
export const maxAuthoredObjectId = (scenario: ScenarioObjects) =>
  listAuthoredObjects(scenario).reduce((max, row) => Math.max(max, row.id), 0);

/** The next free id: the counter, never below `max + 1` (a hand-edited or legacy file without a counter). */
const nextFreeId = (scenario: MapScenario) =>
  Math.max(scenario.nextObjectId ?? 1, maxAuthoredObjectId(scenario) + 1);

/**
 * Allocates a new object id and advances the counter; null when the id space is exhausted. The counter is
 * part of the scenario, so an undo that removes a created object rewinds it together with the object.
 */
export const allocateScenarioObjectId = (scenario: MapScenario): number | null => {
  const id = nextFreeId(scenario);
  if (id > MAX_SCENARIO_OBJECT_ID) return null;
  scenario.nextObjectId = id + 1;
  return id;
};

/**
 * One-time migration on load (ACT1): decoration models without an id get one in row order after the
 * largest existing id, and the counter starts at `max + 1` when the file has none. Deterministic, and a
 * scenario without authored objects stays untouched (its saved bytes stay identical). Returns whether
 * anything changed.
 */
export const assignScenarioObjectIds = (scenario: MapScenario) => {
  const decorations = scenario.decorations ?? [];
  const missing = decorations.some(row => row.id === undefined);
  const hasObjects = scenario.units.length > 0 || scenario.buildings.length > 0 || decorations.length > 0;
  if (!hasObjects || (!missing && scenario.nextObjectId !== undefined)) return false;
  let next = nextFreeId(scenario);
  for (const row of decorations) {
    if (row.id === undefined) row.id = next++;
  }
  scenario.nextObjectId = next;
  return true;
};

/** A map-file object id: a whole number in 1..MAX_SCENARIO_OBJECT_ID. */
export const isScenarioObjectId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SCENARIO_OBJECT_ID;

/**
 * Structural check of the shared id space: every id is unique across all authored collections, and a
 * stored counter is above every id (it never decreases, so it cannot fall behind an allocated id).
 */
export const validScenarioObjectIds = (scenario: ScenarioObjects & { nextObjectId?: unknown }) => {
  const ids = new Set<number>();
  for (const { id } of listAuthoredObjects(scenario)) {
    if (!isScenarioObjectId(id) || ids.has(id)) return false;
    ids.add(id);
  }
  const counter = scenario.nextObjectId;
  if (counter === undefined) return true;
  if (!Number.isSafeInteger(counter) || (counter as number) < 1) return false;
  return (counter as number) <= MAX_SCENARIO_OBJECT_ID + 1 && [...ids].every(id => id < (counter as number));
};
