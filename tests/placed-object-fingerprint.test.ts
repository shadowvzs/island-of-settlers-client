import { describe, expect, it } from "vitest";

import type { RoadDecorationItemId } from "../../island-of-settlers-shared/src/road-decoration-items";
import type { ScriptActor } from "../../island-of-settlers-shared/src/script/types/actors";
import { emptyScript, player1 } from "../../island-of-settlers-shared/tests/script-fixtures";
import { selectedObjectId, warnScriptObjectRemoved } from "../src/app/map-editor/script-object-warning";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import {
  checkWorldPlacedObjects, createPlacedObjectFingerprint, placedObjectFacts
} from "../src/shared/world/placed-object-fingerprint";
import { validateWorldScript } from "../src/shared/world/world-script-ready";

/** TRG1 (deferred ACT1 items): content ids of authored objects, fingerprints, Ready check, delete warning. */

const ARCH = "roadDecoration:roman-rusticated-arch:limestone" as RoadDecorationItemId;

const scenario = (): MapScenario => ({
  ...createMapScenario(), kind: "adventure", nextObjectId: 4,
  buildings: [{ defenders: 0, faction: 1, id: 2, rotation: 0, type: 1, x: 20.5, z: 30.5 }],
  decorations: [{ id: 3, item: ARCH, x: 8.2, yaw: 0, z: 9.9 }],
  units: [{ faction: 1, group: 0, heading: 0, id: 1, rank: 0, type: "shield", x: 12.4, z: 5.6 }]
});

const worldOf = () => ({ cellsX: 64, scenario: scenario() });

describe("placed object fingerprints", () => {
  it("derives the catalog content id and cell of units, buildings and decoration models", () => {
    const world = worldOf();
    expect(placedObjectFacts(world, 1)).toEqual({ cell: 5 * 64 + 12, content: "soldier:shield" });
    expect(placedObjectFacts(world, 2)).toEqual({ cell: 30 * 64 + 20, content: "building:barracks" });
    expect(placedObjectFacts(world, 3)).toEqual({ cell: 9 * 64 + 8, content: "decoration:roman-rusticated-arch" });
    expect(placedObjectFacts(world, 9)).toBeUndefined();
    expect(createPlacedObjectFingerprint(world, 2)).toEqual(
      { cell: 30 * 64 + 20, content: { id: "building:barracks", k: "ref", kind: "content" }, objectId: 2 });
    expect(createPlacedObjectFingerprint({ cellsX: 64 }, 2)).toBeNull();
  });

  it("checks a script's placed bindings against the map and warns when a used object is deleted", () => {
    const world = worldOf();
    const actor: ScriptActor = { binding: "placed", hiddenAtStart: false, id: "actor-1",
      lifetime: "keepIncarnation", name: "Arch", objects: [createPlacedObjectFingerprint(world, 3)!],
      owner: player1 };
    const scripted = { ...world, script: emptyScript({ actors: [actor] }) };
    expect(checkWorldPlacedObjects(scripted)).toEqual([]);
    expect(checkWorldPlacedObjects(worldOf())).toEqual([]);
    const hints: unknown[] = [];
    const store = { setHint: (hint: unknown, refusal?: boolean) => { hints.push([hint, refusal]); } };
    warnScriptObjectRemoved(scripted, store, 3);
    expect(hints).toEqual([]);
    scripted.scenario.decorations = [];
    expect(checkWorldPlacedObjects(scripted).map(issue => issue.code)).toEqual(["placedObjectMissing"]);
    const ready = validateWorldScript(scripted, { mapKind: "adventure" })!;
    expect(ready.ready).toBe(false);
    expect(ready.errors.map(issue => issue.code)).toContain("placedObjectMissing");
    expect(validateWorldScript(worldOf(), { mapKind: "adventure" })).toBeNull();
    warnScriptObjectRemoved(scripted, store, 3);
    expect(hints).toEqual([[expect.objectContaining({ values: { id: 3, users: "actor:actor-1" } }), true]]);
    warnScriptObjectRemoved(scripted, store, 1);
    expect(hints).toHaveLength(1);
  });

  it("reads the map-file id of a scenario selection", () => {
    expect(selectedObjectId("unit:12")).toBe(12);
    expect(selectedObjectId("building:3")).toBe(3);
    expect(selectedObjectId("hq")).toBeUndefined();
  });
});
