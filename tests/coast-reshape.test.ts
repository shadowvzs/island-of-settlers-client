import { describe, expect, it } from "vitest";

import { applyWorldDiff,createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { appendProp } from "../src/shared/world/editing/prop-set";
import {
  commitCoastReshape, listFloodedPlants, previewCoastReshape
} from "../src/shared/world/editing/terrain/coast-reshape";
import { refreshEditedTerrain } from "../src/shared/world/editing/terrain/terrain-apply";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const fixture = () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, forest: 0,
    mountains: 0, rivers: 0, erosionDroplets: 0, oreCapacity: false });
  world.seaLevel = 0; world.props.count = 0; world.mineZone.fill(0); world.mineZones = [];
  world.colonyStoneDeposits = undefined; world.scenario = undefined;
  world.generatedRivers = undefined; world.authoredRivers = undefined;
  world.settlementGroundClearance = undefined; world.flow.fill(0);
  for (let z = 0; z <= 64; z++) for (let x = 0; x <= 64; x++) {
    const i = z * 65 + x;
    world.heights[i] = Math.max(-3, Math.min(2, (x - 32) * .18));
    world.waterSurface[i] = 0; world.waterDepth[i] = Math.max(0, -world.heights[i]!);
  }
  refreshEditedTerrain(world, { minX: 0, minZ: 0, maxX: 63, maxZ: 63 }, true);
  return { world, state: createTerrainEditState() };
};

describe("bounded coast reshape preview", () => {
  it("previews native terrain and navigation without mutating live geometry or painted materials", () => {
    const { state, world } = fixture(), before = structuredClone(world), originalState = structuredClone(state);
    const preview = previewCoastReshape(world, state, { x: 32, z: 32, radius: 5, mode: "beach", strength: .7 });
    expect(preview.changed).toBeGreaterThan(0);
    expect(world).toEqual(before); expect(state).toEqual(originalState);
    for (const layer of ["walking", "sea", "oceanTurning"] as const) {
      expect(preview.after[layer]).toHaveLength(625);
      expect(preview.before[layer]).toHaveLength(625);
    }
    commitCoastReshape(world, state, preview);
    expect(world.splat).toEqual(before.splat);
    expect(world.heights).not.toEqual(before.heights);
    expect(world.heights[0]).toBe(before.heights[0]);
  });

  it("keeps protected live foundations and supports undo/redo of the actual committed terrain", () => {
    const { state, world } = fixture(), stride = 65;
    world.settlementGroundClearance = new Uint8Array(64 * 64);
    world.settlementGroundClearance[32 * 64 + 32] = 1;
    const protectedHeight = world.heights[32 * stride + 32], before = world.heights.slice();
    const preview = previewCoastReshape(world, state, { x: 32, z: 32, radius: 5, mode: "beach", strength: .4 });
    const snapshot = createWorldSnapshot(world, state); snapshot.capture();
    commitCoastReshape(world, state, preview);
    expect(world.heights[32 * stride + 32]).toBe(protectedHeight);
    const after = world.heights.slice(), diff = snapshot.diff()!;
    applyWorldDiff(world, state, diff, "before"); expect(world.heights).toEqual(before);
    applyWorldDiff(world, state, diff, "after"); expect(world.heights).toEqual(after);
  });

  it("tapers an ocean inlet towards a kept shore rock instead of refusing the stroke", () => {
    const { state, world } = fixture(), stride = 65;
    // A rocky 1-unit shore step beside the rock: carving next to it must not steepen it.
    for (let z = 0; z <= 64; z++) world.heights[z * stride + 36]! += 1;
    appendProp(world.props, { form: 0, phase: 0, rotation: 0, scale: 1, type: PROP.largeRock, x: 36.5, y: 2,
      z: 32.5 });
    const before = world.heights.slice();
    const preview = previewCoastReshape(world, state, { x: 32, z: 32, radius: 5, mode: "sea", strength: 1 });
    commitCoastReshape(world, state, preview);
    expect(preview.changed).toBeGreaterThan(0);
    for (let z = 30; z <= 35; z++) for (let x = 34; x <= 39; x++)
      expect(world.heights[z * stride + x], `rock ground ${x},${z}`).toBe(before[z * stride + x]);
    for (let vertex = 0; vertex < before.length; vertex++) {
      if (world.heights[vertex] === before[vertex] || vertex % stride === 64) continue;
      const kept = vertex + 1;
      if (world.heights[kept] !== before[kept]) continue;
      expect(Math.abs(world.heights[vertex]! - world.heights[kept]!))
        .toBeLessThanOrEqual(Math.max(.7, Math.abs(before[vertex]! - before[kept]!) + .04) + 1e-6);
    }
  });

  it("drops land plants the reshaped sea covers, never kept rocks or water plants", () => {
    const { world } = fixture(), draft = structuredClone(world);
    const add = (type: number, x: number) =>
      appendProp(world.props, { form: 0, phase: 0, rotation: 0, scale: 1, type, x, y: 1, z: 20.5 });
    const bush = add(PROP.bush, 40.5);
    add(PROP.largeRock, 41.5); add(PROP.reeds, 42.5);
    add(PROP.bush, 50.5);
    draft.props = structuredClone(world.props);
    for (let z = 18; z <= 23; z++) for (let x = 38; x <= 45; x++) draft.waterDepth[z * 65 + x] = .3;
    expect(listFloodedPlants(world, draft, 12, { x: 40, z: 20 })).toEqual([bush]);
  });

  it("rejects unbounded and nonfinite operations before mutation", () => {
    const { state, world } = fixture(), before = structuredClone(world);
    for (const change of [{ radius: 20 }, { radius: NaN }, { strength: 2 }, { x: -1 }])
      expect(() => previewCoastReshape(world, state,
        { x: 32, z: 32, radius: 5, strength: .7, mode: "sea", ...change })).toThrow("bounded");
    expect(world).toEqual(before);
    const preview = previewCoastReshape(world, state, { x: 32, z: 32, radius: 5, mode: "beach", strength: .7 });
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    const changedWorld = structuredClone(world);
    expect(() => commitCoastReshape(world, state, preview)).toThrow("changed after");
    expect(world).toEqual(changedWorld);
  });
});
