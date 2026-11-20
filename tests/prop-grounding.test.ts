import { describe, expect, it } from "vitest";

import { applyWorldDiff,createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { reanchorPropsAfterTerrainEdit } from "../src/shared/world/editing/prop-grounding";
import { appendProp } from "../src/shared/world/editing/prop-set";
import { refreshEditedTerrain } from "../src/shared/world/editing/terrain/terrain-apply";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getWaterlineFoot, LILY_FLOAT } from "../src/shared/world/generation/water-plants";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

let generated: WorldData | undefined;
const fixture = () => {
  generated ??= cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64,
    forest: 0, mountains: 0, rivers: 0, erosionDroplets: 0, oreCapacity: false });
  const world = structuredClone(generated);
  world.props.types.fill(PROP_REMOVED); world.heights.fill(2); world.waterSurface.fill(0);
  const add = (type: number, x = 30.25, z = 30.25) => appendProp(world.props,
    { type, x, y: 2, z, scale: 1.3, rotation: .7, form: 1, phase: .2 });
  return { world, add };
};
const region = { minX: 30, minZ: 30, maxX: 31, maxZ: 31 };

describe("terrain edit prop grounding", () => {
  it("follows both raised and lowered ground for trees, stones and doodads without changing identities", () => {
    const { add, world } = fixture();
    const ids = [add(PROP.coniferTree), add(PROP.hardwoodTree), add(PROP.largeRock), add(PROP.flowers)];
    const outside = add(PROP.bush, 40, 40), removed = add(PROP_REMOVED);
    const types = world.props.types.slice(), x = world.props.x.slice(), z = world.props.z.slice();
    const scales = world.props.scale.slice(), rotations = world.props.rotation.slice(), forms = world.props.form.slice();
    world.heights.fill(5);
    expect(reanchorPropsAfterTerrainEdit(world, region)).toEqual(ids);
    ids.forEach(id => expect(world.props.y[id]).toBe(5));
    world.heights.fill(1);
    expect(reanchorPropsAfterTerrainEdit(world, region)).toEqual(ids);
    ids.forEach(id => expect(world.props.y[id]).toBe(1));
    expect(world.props.y[outside]).toBe(2); expect(world.props.y[removed]).toBe(2);
    expect(world.props.types).toEqual(types); expect(world.props.x).toEqual(x); expect(world.props.z).toEqual(z);
    expect(world.props.scale).toEqual(scales); expect(world.props.rotation).toEqual(rotations); expect(world.props.form).toEqual(forms);
  });
  it("includes cubic interpolation neighbours outside the dirty cell and reports only actual moves", () => {
    const { add, world } = fixture(), near = add(PROP.smallRock, 29.5, 30.5), far = add(PROP.smallRock, 26, 30);
    world.heights[30 * 65 + 30] = 3;
    const expected = sampleSmooth(world, world.heights, world.props.x[near]!, world.props.z[near]!);
    expect(expected).not.toBe(2);
    expect(reanchorPropsAfterTerrainEdit(world, region)).toEqual([near]);
    expect(world.props.y[near]).toBeCloseTo(expected); expect(world.props.y[far]).toBe(2);
    expect(reanchorPropsAfterTerrainEdit(world, region)).toEqual([]);
  });
  it("anchors floating lilies and wading reeds/cattails without erasing newly invalid habitats", () => {
    const { add, world } = fixture(), lily = add(PROP.waterLily), reeds = add(PROP.reeds), cattail = add(PROP.cattail);
    world.waterSurface.fill(3);
    reanchorPropsAfterTerrainEdit(world, region);
    expect(world.props.y[lily]).toBeCloseTo(3 + LILY_FLOAT);
    for (const id of [reeds, cattail]) expect(world.props.y[id]).toBeCloseTo(getWaterlineFoot(2, 3));
    world.waterSurface.fill(0); world.heights.fill(4);
    reanchorPropsAfterTerrainEdit(world, region);
    expect(world.props.y[lily]).toBeCloseTo(4 + LILY_FLOAT);
    for (const id of [reeds, cattail]) expect(world.props.y[id]).toBe(4);
    expect(world.props.types[lily]).toBe(PROP.waterLily);
  });
  it("the shared refresh persists moved Y in history and map layers", async () => {
    const { add, world } = fixture(), stone = add(PROP.largeRock), state = createTerrainEditState();
    const snapshot = createWorldSnapshot(world, state); snapshot.capture();
    for (let z = 29; z <= 33; z++) for (let x = 29; x <= 33; x++) world.heights[z * 65 + x] = 3;
    refreshEditedTerrain(world, region, false);
    expect(world.props.y[stone]).toBe(3);
    const diff = snapshot.diff()!;
    applyWorldDiff(world, state, diff, "before"); expect(world.props.y[stone]).toBe(2);
    applyWorldDiff(world, state, diff, "after"); expect(world.props.y[stone]).toBe(3);
    const bytes = await writeMapFile(world, { name: "Grounding", source: "generated", savedAt: 0, animals: [], terrain: state });
    const restored = await readMapFile(bytes); expect(restored.world.props.y[stone]).toBe(3);
  });
});
