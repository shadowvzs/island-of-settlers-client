import { describe, expect, it } from "vitest";

import { ALPINE_HEIGHT_SAMPLES } from "../src/shared/world/editing/terrain/alpine-height-data";
import { sampleMountainTemplate } from "../src/shared/world/editing/terrain/mountain-template";
import { applyStampChange } from "../src/shared/world/editing/terrain/terrain-apply";
import { addStamp, createTerrainEditState, lowerStampAt } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { getStampRise, type TerrainStamp } from "../src/shared/world/editing/terrain/terrain-stamps";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getVertexSlope } from "../src/shared/world/grid-geometry";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { BLOCKING, BUILD, MATERIAL, MATERIAL_COUNT, PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

describe("processed mountain terrain", () => {
  it("uses a bounded feathered profile rather than a source mesh or rectangular slab", () => {
    expect(ALPINE_HEIGHT_SAMPLES.byteLength).toBe(2178);
    for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
      expect(sampleMountainTemplate(Math.cos(angle) * 1.01, Math.sin(angle) * 1.01)).toBe(0);
      expect(sampleMountainTemplate(Math.cos(angle) * 0.999, Math.sin(angle) * 0.999)).toBeLessThan(0.005);
    }
    expect(sampleMountainTemplate(0.2, 0.1)).not.toBeCloseTo(sampleMountainTemplate(-0.2, -0.1), 2);
  });

  it("grows monotonically, keeps its original source choice and merges without stacked height", () => {
    const stamp: TerrainStamp = { id: 1, level: 1, seed: 51, x: 0, z: 0, template: "great-mountain-v1" };
    for (let x = -15; x <= 15; x += 0.5) for (let z = -15; z <= 15; z += 0.5) {
      let last = 0;
      for (let level = 1; level <= 6; level += 1) {
        const rise = getStampRise({ ...stamp, level }, x, z);
        expect(rise).toBeGreaterThanOrEqual(last);
        expect(rise).toBeLessThanOrEqual(7);
        last = rise;
      }
    }
  });

  const FLAT_WORLD = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000, mountains: 0 };
  preloadWorlds(FLAT_WORLD);
  it("updates physical terrain, creates safe shelf plants and preserves loaded lowering exactly", async () => {
    const world = cachedWorld(FLAT_WORLD);
    let spot: { x: number; z: number } | undefined;
    for (let z = 20; z < 76 && !spot; z += 1) for (let x = 20; x < 76 && !spot; x += 1) {
      const vertex = z * 97 + x;
      if (world.buildClass[z * 96 + x] === BUILD.large && world.riverDistance[vertex]! > 18 &&
        world.coastDistance[vertex]! > 14) spot = { x: x + 0.5, z: z + 0.5 };
    }
    expect(spot).toBeDefined();
    const state = createTerrainEditState();
    const before = world.heights.slice();
    const change = addStamp(state, spot!, 6, 51, { template: "great-mountain-v1" });
    applyStampChange(world, state, change);
    const peakRise = Math.max(...world.heights.map((height, vertex) => height - before[vertex]!));
    expect(peakRise).toBeGreaterThan(5.5);
    expect([...world.slopeClass].filter(slope => slope > 1).length).toBeGreaterThan(10);
    expect(world.heights[0]).toBe(before[0]);
    const plants = state.stampProps.get(change.after!.id)!;
    expect(plants.length).toBeGreaterThan(0);
    for (const index of plants) {
      const x = world.props.x[index]!, z = world.props.z[index]!;
      const cell = Math.floor(z) * world.cellsX + Math.floor(x);
      expect(world.blocking[cell]).not.toBe(BLOCKING.water);
      expect(world.blocking[cell]).not.toBe(BLOCKING.cliff);
      expect(getVertexSlope(world, world.heights, Math.round(x), Math.round(z))).toBeLessThan(0.5);
      if (world.props.types[index] === PROP.coniferTree) expect(world.blocking[cell]).toBe(BLOCKING.prop);
      const vertex = Math.round(z) * 97 + Math.round(x);
      expect(world.splat[vertex * MATERIAL_COUNT + MATERIAL.mine]!).toBeLessThan(90);
    }
    const loaded = await readMapFile(await writeMapFile(world, {
      animals: [], name: "Alpine", savedAt: 1_791_676_800_000, source: "seed=123", terrain: state
    }));
    expect(loaded.terrain).toEqual(state);
    expect(loaded.world.heights).toEqual(world.heights);
    for (const copy of [{ state, world }, { state: loaded.terrain!, world: loaded.world }]) {
      applyStampChange(copy.world, copy.state, lowerStampAt(copy.state, spot!.x, spot!.z)!);
    }
    expect(loaded.world.heights).toEqual(world.heights);
    expect(loaded.world.blocking).toEqual(world.blocking);
    expect(plants.every(index => world.props.types[index] === PROP_REMOVED)).toBe(true);
    const overlap = addStamp(state, { x: spot!.x + 4, z: spot!.z }, 5, 9,
      { template: "great-mountain-v1", to: { x: spot!.x + 4, z: spot!.z + 6 } });
    applyStampChange(world, state, overlap);
    for (const indices of state.stampProps.values()) for (const index of indices) {
      const x = world.props.x[index]!, z = world.props.z[index]!;
      expect(world.props.y[index]).toBeCloseTo(sampleSmooth(world, world.heights, x, z), 5);
      const cell = Math.floor(z) * world.cellsX + Math.floor(x);
      expect(world.blocking[cell]).not.toBe(BLOCKING.water);
      expect(world.blocking[cell]).not.toBe(BLOCKING.cliff);
    }
  });
});
