import { worldScriptUsersOfObject } from "../../shared/world/placed-object-fingerprint";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorStore } from "./editor-store";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "./messages";

/**
 * After a map object was deleted (TRG1, deferred ACT1 step 5): warn with the script owners that bound it. The
 * delete stays allowed (undo restores the object); the Ready check reports the missing binding until it is fixed.
 */
export const warnScriptObjectRemoved = (
  world: Pick<WorldData, "scenario" | "script">, store: Pick<EditorStore, "setHint">, objectId: number | undefined
) => {
  if (objectId === undefined || !world.script) return;
  if (world.scenario && [...world.scenario.units, ...world.scenario.buildings, ...world.scenario.decorations ?? []]
    .some(row => row.id === objectId)) return;
  const users = worldScriptUsersOfObject(world, objectId);
  if (!users.length) return;
  store.setHint(editorMessage(M.hints.scriptObjectRemoved, { id: objectId, users: users.join(", ") }), true);
};

/** The map-file id of a scenario selection (`unit:<id>` or `building:<id>`), else undefined. */
export const selectedObjectId = (selection: string) => {
  const match = /^(?:unit|building):(\d+)$/.exec(selection);
  return match ? Number(match[1]) : undefined;
};
