import { describe, expect, it } from "vitest";

import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import {
  regenerateSeedTerrainSelection, seedRegenerationProblem, seedTerrainSource
} from "../src/shared/world/editing/terrain/scoped-seed-regeneration";
import { assertSeedRestoreBoundary } from "../src/shared/world/editing/terrain/seed-restore-boundary";
import { seedRestoreProtectedVertices } from "../src/shared/world/editing/terrain/seed-restore-protection";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../src/shared/world/generation/generate-world";
import {
  TERRAIN_GENERATOR_VERSION, validGenerationProvenance
} from "../src/shared/world/generation/generation-provenance";
import { createUniformLayout } from "../src/shared/world/generation/theme-field";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const options = { ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 1234,
  forest: 0, mountains: 0, rivers: 0, erosionDroplets: 0, oreCapacity: false };
let generated: WorldData | undefined;
const fixture = () => {
  generated ??= cachedWorld(options);
  const candidate = structuredClone(generated), world = structuredClone(generated);
  world.props.types.fill(PROP_REMOVED);
  const state = createTerrainEditState(), source = seedTerrainSource(world, candidate);
  const cells = Array.from({ length: 16 * 16 }, (_, index) =>
    (24 + Math.floor(index / 16)) * 64 + 24 + index % 16);
  const protectedVertices = seedRestoreProtectedVertices(world, state,
    { minX: 24, minZ: 24, maxX: 39, maxZ: 39 });
  // The old fixed (32,32) target lies in a real ore-deposit interpolation halo.
  // Exercise successful restoration on actual unprotected, dry native interior;
  // keep the generated ore and separate protection cases intact.
  const target = Array.from({ length: 14 * 14 }, (_, index) =>
    ({ x: 25 + index % 14, z: 25 + Math.floor(index / 14) })).find(({ x, z }) => {
      const vertex = z * 65 + x;
      return !protectedVertices.has(vertex) && world.heights[vertex]! > world.seaLevel + 1 &&
        Math.hypot(world.flow[vertex * 2]!, world.flow[vertex * 2 + 1]!) < .01;
    });
  expect(target, "Native fixture must contain unprotected dry interior").toBeDefined();
  const { x, z } = target!, vertex = z * 65 + x;
  expect(protectedVertices.has(vertex)).toBe(false);
  expect(cells).toEqual(expect.arrayContaining([
    (z - 1) * 64 + x - 1, (z - 1) * 64 + x, z * 64 + x - 1, z * 64 + x
  ]));
  return { candidate, world, state, source, vertex, x, z, cells };
};

describe("recorded built-in generator provenance", () => {
  it("records complete exact options and refuses legacy, unsupported or mismatched recipes", () => {
    const { candidate, world } = fixture();
    expect(world.generationProvenance).toEqual({ version: 1,
      generatorVersion: TERRAIN_GENERATOR_VERSION, options });
    expect(validGenerationProvenance(world.generationProvenance)).toBe(true);
    expect(seedRegenerationProblem(world)).toBeNull();
    world.generationProvenance = undefined;
    expect(seedRegenerationProblem(world)).toMatch(/no exact saved generator recipe/);
    world.generationProvenance = { ...candidate.generationProvenance!, generatorVersion: "old-generator" };
    expect(seedRegenerationProblem(world)).toMatch(/different terrain generator version/);
    world.generationProvenance = { ...candidate.generationProvenance!, options: { ...options, seed: 7 } };
    expect(seedRegenerationProblem(world)).toMatch(/different map/);
    expect(validGenerationProvenance({ ...candidate.generationProvenance, options: { ...options, script: "ignored" } }))
      .toBe(false);
    expect(validGenerationProvenance({ ...candidate.generationProvenance, options: { ...options, cellsX: 999999 } }))
      .toBe(false);
  });
  it("does not invent provenance for custom theme layout callbacks", () => {
    expect(generateWorld(options, createUniformLayout("meadow")).generationProvenance).toBeUndefined();
  });
});

describe("protected exact scoped seed terrain restoration", () => {
  it("restores selected interior only, keeps paint/props/ore and supports undo/redo and map persistence", async () => {
    const { candidate, cells, source, state, vertex, world } = fixture();
    world.heights[vertex] = world.heights[vertex]! + .1;
    const changedHeight = world.heights[vertex]!;
    const before = world.heights.slice(), paints = world.splat.slice(), types = world.props.types.slice();
    const ore = world.oreAmount.slice(), zones = world.mineZone.slice();
    const snapshot = createWorldSnapshot(world, state); snapshot.capture();
    const result = regenerateSeedTerrainSelection(world, state, cells, source);
    expect(result.changed).toBe(1); expect(world.heights[vertex]).toBe(candidate.heights[vertex]);
    for (let index = 0; index < before.length; index++) if (index !== vertex)
      expect(world.heights[index]).toBe(before[index]);
    expect(world.splat).toEqual(paints); expect(world.props.types).toEqual(types);
    expect(world.oreAmount).toEqual(ore); expect(world.mineZone).toEqual(zones);
    const diff = snapshot.diff()!; expect(diff).not.toBeNull();
    applyWorldDiff(world, state, diff, "before"); expect(world.heights[vertex]).toBe(changedHeight);
    applyWorldDiff(world, state, diff, "after"); expect(world.heights[vertex]).toBe(candidate.heights[vertex]);
    const bytes = await writeMapFile(world, { name: "Seed contour", source: "generated", savedAt: 0,
      animals: [], terrain: state });
    const loaded = await readMapFile(bytes);
    expect(loaded.world.generationProvenance).toEqual(world.generationProvenance);
    expect(loaded.world.heights).toEqual(world.heights);
    expect(loaded.world.splat).toEqual(paints);
  });
  it("rebuilds and re-anchors only around the restored vertices, not the whole selected contour", () => {
    const { cells, source, state, vertex, world, x, z } = fixture();
    world.heights[vertex] = world.heights[vertex]! + .1;
    const far = { x: x < 32 ? 38.5 : 24.5, z: z < 32 ? 38.5 : 24.5 };
    world.props.types[0] = PROP.reeds; world.props.x[0] = far.x; world.props.z[0] = far.z; world.props.y[0] = 7;
    const result = regenerateSeedTerrainSelection(world, state, cells, source);
    expect(result.cells).toEqual({ minX: x - 1, minZ: z - 1, maxX: x, maxZ: z });
    expect(world.props.y[0]).toBe(7);
  });
  it.each(["ore", "road", "hq", "stamp", "river"])("retains protected %s terrain and its authored identity", kind => {
    const { cells, source, state, vertex, world, x, z } = fixture();
    world.heights[vertex] = world.heights[vertex]! + .1;
    if (kind === "ore") world.mineZone[z * 64 + x] = 1;
    if (kind === "road") {
      world.settlementGroundClearance = new Uint8Array(64 ** 2);
      world.settlementGroundClearance[z * 64 + x] = 1;
    }
    if (kind === "hq") world.scenario = { ...createMapScenario(), headquarters: { x, z, rotation: 0 } };
    if (kind === "stamp") state.stamps.push({ id: 3, x, z, seed: 2, level: 2 });
    if (kind === "river") world.flow[vertex * 2] = 1;
    const before = world.heights.slice(), stamps = structuredClone(state.stamps), scenario = structuredClone(world.scenario);
    expect(regenerateSeedTerrainSelection(world, state, cells, source).changed).toBe(0);
    expect(world.heights).toEqual(before); expect(state.stamps).toEqual(stamps); expect(world.scenario).toEqual(scenario);
  });
  it("restores a brushed vertex beside a steep join that the original seed terrain already had", () => {
    const { candidate, cells, source, state, vertex, world } = fixture();
    for (const index of [vertex, vertex - 1, vertex + 1, vertex - 65, vertex + 65])
      candidate.heights[index] = world.heights[index] = 2;
    candidate.heights[vertex + 1] = world.heights[vertex + 1] = 3;
    // A raise brush softened the natural 1.0 step; regeneration brings the exact step back.
    world.heights[vertex] = 2.3;
    expect(regenerateSeedTerrainSelection(world, state, cells, source).changed).toBe(1);
    expect(world.heights[vertex]).toBe(2);
  });
  it("rejects newly steep boundary joins before any mutation instead of silently feathering", () => {
    const { source, state, vertex, world } = fixture();
    // The seed was a 5-high plateau; its retained (protected) neighbours now stand at 2.
    world.heights.fill(2); world.waterSurface.fill(0); source.heights.fill(5); source.waterSurface.fill(0);
    const before = world.heights.slice();
    expect(() => assertSeedRestoreBoundary(world, [vertex], source)).toThrow(/steep join/);
    expect(world.heights).toEqual(before); expect(state.base).toBeNull();
  });
  it("rejects split retained water levels at a copied boundary", () => {
    const { source, vertex, world } = fixture();
    world.heights.fill(0); world.waterSurface.fill(1); source.heights.fill(0); source.waterSurface.fill(1);
    source.waterSurface[vertex] = 2;
    expect(() => assertSeedRestoreBoundary(world, [vertex], source)).toThrow(/water surface/);
  });
});
