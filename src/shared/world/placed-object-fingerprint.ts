import { buildingEntry, decorationEntry, soldierEntry } from "../../../../island-of-settlers-shared/src/catalog/index";
import type { ScriptIssue } from "../../../../island-of-settlers-shared/src/script/issues";
import {
  checkPlacedObjects, type PlacedObjectFacts, scriptUsersOfObject
} from "../../../../island-of-settlers-shared/src/script/placed-objects";
import type { PlacedObjectFingerprint } from "../../../../island-of-settlers-shared/src/script/types/actors";
import type { MapScenario } from "./map-scenario";
import type { WorldData } from "./world-data";

/**
 * Map-side facts of placed script actors (TRG1, deferred from ACT1): the catalog content id of an authored object
 * (`PlacedObjectFingerprint.content`), its cell, the fingerprint the actor panel stores, the Ready check against
 * the map and the script users of an object the editor is about to delete.
 */

type ScenarioObjects = Pick<MapScenario, "buildings" | "decorations" | "units">;

/** `roadDecoration:<key>:<finish>` → the decoration entry's content id. */
const decorationContent = (item: string) => decorationEntry(item.split(":")[1] ?? "")?.id;

const objectFacts = (cellsX: number, x: number, z: number, content: string | undefined) =>
  content === undefined ? undefined : { cell: Math.floor(z) * cellsX + Math.floor(x), content };

/** Content id and cell of every authored object with a map-file id (units, buildings, decoration models). */
const authoredObjectFacts = (scenario: ScenarioObjects, cellsX: number) => {
  const facts = new Map<number, PlacedObjectFacts>();
  const add = (id: number | undefined, value: PlacedObjectFacts | undefined) => {
    if (id !== undefined && value) facts.set(id, value);
  };
  for (const unit of scenario.units) add(unit.id, objectFacts(cellsX, unit.x, unit.z, soldierEntry(unit.type)?.id));
  for (const site of scenario.buildings)
    add(site.id, objectFacts(cellsX, site.x, site.z, buildingEntry(site.type)?.id));
  for (const row of scenario.decorations ?? [])
    add(row.id, objectFacts(cellsX, row.x, row.z, decorationContent(row.item)));
  return facts;
};

/** What the map holds under a map-file id now (undefined: no such object or no catalog entry). */
export const placedObjectFacts = (world: Pick<WorldData, "cellsX" | "scenario">, objectId: number) =>
  world.scenario ? authoredObjectFacts(world.scenario, world.cellsX).get(objectId) : undefined;

/** The fingerprint an actor stores when it binds this map object; null when the map has no such object. */
export const createPlacedObjectFingerprint = (
  world: Pick<WorldData, "cellsX" | "scenario">, objectId: number
): PlacedObjectFingerprint | null => {
  const facts = placedObjectFacts(world, objectId);
  if (!facts) return null;
  return { cell: facts.cell, content: { id: facts.content, k: "ref", kind: "content" }, objectId };
};

/** The Ready check of the map script's placed fingerprints against this map (no script: nothing to check). */
export const checkWorldPlacedObjects = (world: Pick<WorldData, "cellsX" | "scenario" | "script">): ScriptIssue[] => {
  if (!world.script) return [];
  const facts = world.scenario ? authoredObjectFacts(world.scenario, world.cellsX) : new Map();
  return checkPlacedObjects(world.script, objectId => facts.get(objectId));
};

/** Script owners that use a map object (sorted; empty without a script or users). */
export const worldScriptUsersOfObject = (world: Pick<WorldData, "script">, objectId: number) =>
  world.script ? scriptUsersOfObject(world.script, objectId) : [];
