import { describe, expect, it } from "vitest";

import { editAuthoredRiver, eraseRiverWater } from "../src/shared/world/editing/authored-rivers";
import { editGeneratedRiver } from "../src/shared/world/editing/generated-river-edit";
import { generatedRiverPatchLimit, isGeneratedRiverList } from "../src/shared/world/editing/generated-river-types";
import { applyWorldDiff,createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { refreshEditedTerrain } from "../src/shared/world/editing/terrain/terrain-apply";
import { computeDistanceField } from "../src/shared/world/generation/distance-field";
import { createGeneratedRiverCapture } from "../src/shared/world/generation/generated-river-capture";
import { carveRivers } from "../src/shared/world/generation/river-carving";
import { createWaterLayers } from "../src/shared/world/generation/water";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const fixture = () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  world.props.count = 0; world.mineZone.fill(0); world.mineZones = [];
  world.seaLevel = 0;
  for (let i = 0; i < world.heights.length; i++) world.heights[i] = 8 - Math.floor(i / 97) * .1;
  const courses = [20, 75].map(x => ({ mouthStep: 72,
    points: Array.from({ length: 81 }, (_, i) => ({ x, z: i + 8 })) }));
  const widths = () => .6;
  const capture = createGeneratedRiverCapture(world, world.heights, world.seaLevel, widths);
  const layers = carveRivers(world, world.heights, courses, world.seaLevel, widths, capture);
  const water = createWaterLayers(world, world.heights, layers.surface, world.seaLevel);
  world.waterSurface.set(water.waterSurface); world.waterDepth.set(water.waterDepth);
  world.flow.set(layers.flow); world.waterfalls = layers.waterfalls;
  world.riverDistance.set(computeDistanceField(world, i => layers.mask[i] === 1));
  world.generatedRivers = capture.finish(world);
  refreshEditedTerrain(world, { minX: 0, minZ: 0, maxX: 95, maxZ: 95 }, true);
  return world;
};

describe("selected generated river editing", () => {
  it("validates bounded provenance and rejects malformed scales, samples and duplicate IDs", () => {
    const world = fixture(), records = world.generatedRivers!;
    expect(records).toHaveLength(2);
    expect(isGeneratedRiverList(records, 96, 96)).toBe(true);
    for (const change of [{ widthScale: NaN }, { depthScale: 0 }, { profile: [] }, { mouthStep: 9999 },
      { suppressedVertices: [-1] }, { suppressedVertices: [0, 0] }])
      expect(isGeneratedRiverList([{ ...records[0]!, ...change }], 96, 96)).toBe(false);
    expect(isGeneratedRiverList([records[0], records[0]], 96, 96)).toBe(false);
    expect(generatedRiverPatchLimit(1_000_000)).toBe(131072);
  });

  it("changes one captured channel while preserving every other channel's shape and definition", () => {
    const world = fixture(), other = structuredClone(world.generatedRivers![1]!);
    const before = structuredClone(world), selected = world.generatedRivers![0]!;
    const result = editGeneratedRiver(world, { ...selected, widthScale: 1.2, depthScale: 1.3 });
    expect(world.generatedRivers!.find(river => river.id === other.id)).toEqual(other);
    const edited = world.generatedRivers!.find(river => river.id === selected.id)!;
    expect(edited.points).toEqual(selected.points);
    expect(edited.radius).toEqual(selected.radius);
    const touched = new Set(result.baseVertices);
    for (let i = 0; i < world.heights.length; i++) if (!touched.has(i)) {
      expect(world.heights[i]).toBe(before.heights[i]);
      expect(world.waterSurface[i]).toBe(before.waterSurface[i]);
      expect(world.flow[i * 2]).toBe(before.flow[i * 2]);
      expect(world.flow[i * 2 + 1]).toBe(before.flow[i * 2 + 1]);
    }
  });

  it("treats identical dimensions and course as a nonmutating operation even at overlapping banks", () => {
    const world = fixture(), selected = world.generatedRivers![0]!;
    world.generatedRivers![1]!.patches.push(structuredClone(selected.patches[0]!));
    const before = structuredClone(world);
    let commits = 0;
    const result = editGeneratedRiver(world, structuredClone(selected), undefined, false, () => { commits++; });
    expect(commits).toBe(0); expect(result.baseVertices).toEqual([]); expect(world).toEqual(before);
  });

  it("preserves later manual heights on removal and records definitions through undo/redo", () => {
    const world = fixture(), selected = world.generatedRivers![0]!;
    const vertex = selected.patches.find(patch => patch.before[0] !== patch.after[0])!.vertex;
    world.heights[vertex] = world.heights[vertex]! + 2;
    const manual = world.heights[vertex], snapshot = createWorldSnapshot(world, null);
    snapshot.capture(); editGeneratedRiver(world, null, selected.id);
    expect(world.heights[vertex]).toBe(manual);
    expect(world.waterDepth[vertex]).toBeCloseTo(Math.max(0, world.waterSurface[vertex]! - manual!));
    expect(world.generatedRivers).toHaveLength(1);
    const diff = snapshot.diff()!;
    applyWorldDiff(world, null, diff, "before");
    expect(world.generatedRivers).toHaveLength(2);
    applyWorldDiff(world, null, diff, "after");
    expect(world.generatedRivers).toHaveLength(1);
  });

  it("round-trips generated definitions without recarving or requiring seed reconstruction", async () => {
    const world = fixture(), original = structuredClone(world.generatedRivers);
    const loaded = (await readMapFile(await writeMapFile(world, {
      name: "Generated river definitions", source: "generated", savedAt: 1, animals: []
    }))).world;
    expect(loaded.generatedRivers).toEqual(original);
    expect(loaded.heights).toEqual(world.heights);
    editGeneratedRiver(loaded, { ...loaded.generatedRivers![0]!, depthScale: 1.2 });
    expect(loaded.generatedRivers).toHaveLength(2);
  });

  it("composes an overlapping drawn channel and restores captured terrain when it is removed", () => {
    const world = fixture(), heights = world.heights.slice(), flow = world.flow.slice();
    editAuthoredRiver(world, { id: 1,
      points: [{ x: 18, z: 20 }, { x: 22, z: 40 }], width: 2, depth: .7 });
    const drawn = world.authoredRivers![0]!;
    expect(drawn.patches.some(patch => world.generatedRivers![0]!.patches
      .some(original => original.vertex === patch.vertex))).toBe(true);
    editAuthoredRiver(world, null, 1);
    expect(world.heights).toEqual(heights);
    expect(world.flow).toEqual(flow);
  });

  it("recomposes a dependent drawn channel when the generated channel underneath changes", () => {
    const world = fixture();
    editAuthoredRiver(world, { id: 1,
      points: [{ x: 18, z: 20 }, { x: 22, z: 40 }], width: 2, depth: .7 });
    const drawn = structuredClone(world.authoredRivers![0]!);
    const selected = world.generatedRivers![0]!;
    editGeneratedRiver(world, { ...selected, depthScale: 1.4 });
    expect(world.authoredRivers![0]!.points).toEqual(drawn.points);
    expect(world.authoredRivers![0]!.id).toBe(drawn.id);
    expect([...world.waterDepth].every((depth, vertex) =>
      Math.abs(depth - Math.max(0, world.waterSurface[vertex]! - world.heights[vertex]!)) < .001)).toBe(true);
    const expected = fixture();
    editGeneratedRiver(expected, { ...expected.generatedRivers![0]!, depthScale: 1.4 });
    editAuthoredRiver(world, null, 1);
    expect(world.heights).toEqual(expected.heights);
    expect(world.flow).toEqual(expected.flow);
  });

  it("rebuilds a connected selected source course while retaining the other captured definition", () => {
    const world = fixture(), selected = world.generatedRivers![0]!;
    const other = structuredClone(world.generatedRivers![1]);
    const points = selected.points.map(point => ({ ...point }));
    points[0] = { x: 23, z: 9 };
    editGeneratedRiver(world, { ...selected, points }, undefined, true);
    const edited = world.generatedRivers!.find(river => river.id === selected.id)!;
    expect(edited.points[0]).toEqual(points[0]);
    expect(edited.profile).toHaveLength(edited.points.length);
    expect(world.generatedRivers!.find(river => river.id === other!.id)).toEqual(other);
  });

  it("keeps partial water erased across resize, map save/reload and undo/redo without changing distant water", async () => {
    const world = fixture(), before = structuredClone(world), snapshot = createWorldSnapshot(world, null);
    const vertex = 40 * 97 + 20, other = structuredClone(world.generatedRivers![1]!);
    expect(world.flow[vertex * 2] || world.flow[vertex * 2 + 1]).not.toBe(0);
    snapshot.capture(); eraseRiverWater(world, { x: 20, z: 40 }, 2.2);
    expect(world.heights).toEqual(before.heights);
    expect(world.flow[vertex * 2]).toBe(0); expect(world.flow[vertex * 2 + 1]).toBe(0);
    const diff = snapshot.diff()!;
    applyWorldDiff(world, null, diff, "before");
    expect(world.generatedRivers![0]!.suppressedVertices).toBeUndefined();
    expect(world.flow).toEqual(before.flow);
    applyWorldDiff(world, null, diff, "after");
    expect(world.generatedRivers![0]!.suppressedVertices).toContain(vertex);
    editGeneratedRiver(world, { ...world.generatedRivers![0]!, widthScale: 1.3, depthScale: 1.2 });
    expect(world.flow[vertex * 2]).toBe(0); expect(world.flow[vertex * 2 + 1]).toBe(0);
    for (const patch of other.patches) {
      expect(world.waterSurface[patch.vertex]).toBe(before.waterSurface[patch.vertex]);
      expect(world.flow[patch.vertex * 2]).toBe(before.flow[patch.vertex * 2]);
      expect(world.flow[patch.vertex * 2 + 1]).toBe(before.flow[patch.vertex * 2 + 1]);
    }
    const loaded = (await readMapFile(await writeMapFile(world, {
      name: "Partially drained river", source: "generated", savedAt: 1, animals: []
    }))).world;
    const selected = loaded.generatedRivers!.find(river => river.id === before.generatedRivers![0]!.id)!;
    expect(selected.suppressedVertices).toContain(vertex);
    editGeneratedRiver(loaded, { ...selected, widthScale: 1.4 });
    expect(loaded.flow[vertex * 2]).toBe(0); expect(loaded.flow[vertex * 2 + 1]).toBe(0);
    expect(loaded.waterDepth[vertex]).toBeCloseTo(Math.max(0, loaded.seaLevel - loaded.heights[vertex]!));
  });

  it("does not restore erased water when removing a suppressed generated definition", () => {
    const world = fixture(), vertex = 40 * 97 + 20, id = world.generatedRivers![0]!.id;
    eraseRiverWater(world, { x: 20, z: 40 }, 2.2);
    editGeneratedRiver(world, null, id);
    expect(world.flow[vertex * 2]).toBe(0); expect(world.flow[vertex * 2 + 1]).toBe(0);
    expect(world.waterDepth[vertex]).toBeCloseTo(Math.max(0, world.seaLevel - world.heights[vertex]!));
  });

  it("suppresses a native waterfall through later width changes", () => {
    const world = fixture(), selected = world.generatedRivers![0]!;
    const profile = selected.profile.map((_value, i) => {
      if (i < 35) return 5;
      return i < selected.mouthStep ? 1 : 0;
    });
    editGeneratedRiver(world, { ...selected, profile, widthScale: 1.1 });
    const changed = world.generatedRivers!.find(river => river.id === selected.id)!;
    expect(changed.falls.length).toBeGreaterThan(0);
    const fall = changed.falls[0]!, heights = world.heights.slice();
    eraseRiverWater(world, { x: fall.x, z: fall.z }, 2);
    expect(world.heights).toEqual(heights);
    const erased = world.generatedRivers!.find(river => river.id === selected.id)!;
    editGeneratedRiver(world, { ...erased, widthScale: 1.2 });
    expect(world.waterfalls.some(candidate => Math.hypot(candidate.x - fall.x, candidate.z - fall.z) < .01))
      .toBe(false);
  });

  it("rejects an excessive joint suppression mask before changing live water or invoking commit hooks", () => {
    const world = fixture();
    world.generatedRivers!.push({ ...structuredClone(world.generatedRivers![0]!), id: 3 });
    const before = structuredClone(world);
    let commits = 0;
    expect(() => eraseRiverWater(world, { x: 48, z: 48 }, 200, () => { commits++; }))
      .toThrow("budget");
    expect(commits).toBe(0); expect(world).toEqual(before);
  });
});
