import { describe, expect, it } from "vitest";

import {
  createHistoryRebuild,
  type HistoryRebuildOptions
} from "../src/app/map-editor/history-rebuild";
import {
  applyWorldDiff,
  createWorldSnapshot
} from "../src/shared/world/editing/history/world-diff";
import { appendProp } from "../src/shared/world/editing/prop-set";
import { transformGeneratedFeature } from "../src/shared/world/editing/terrain/generated-feature-transform";
import type { TerrainComponent } from "../src/shared/world/editing/terrain/terrain-component";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { somePropNear } from "../src/shared/world/prop-cell-index";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

let original: WorldData | undefined;
const fixture = (lake = false) => {
  original ??= cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 64,
    cellsZ: 64,
    forest: 0,
    mountains: 0,
    rivers: 0,
    erosionDroplets: 0,
    oreCapacity: false
  });
  const world = structuredClone(original),
    state = createTerrainEditState();
  world.props.types.fill(PROP_REMOVED);
  world.mineZone.fill(0);
  world.flow.fill(0);
  world.heights.fill(10);
  world.waterSurface.fill(0);
  world.waterDepth.fill(0);
  world.lakeWater?.fill(0);
  world.roadGradeApplied = undefined;
  world.roadGradeBase = undefined;
  world.settlementGroundClearance?.fill(0);
  world.scenario = undefined;
  world.colonyStoneDeposits = undefined;
  world.authoredRivers = undefined;
  const cells: number[] = [];
  for (let z = 18; z < 26; z++) for (let x = 18; x < 26; x++) cells.push(z * 64 + x);
  for (let z = 18; z <= 26; z++)
    for (let x = 18; x <= 26; x++) {
      const amplitude = Math.max(0, 1 - Math.hypot(x - 22, z - 22) / 4),
        vertex = z * 65 + x;
      world.heights[vertex] = lake ? 10 - amplitude : 10 + amplitude;
      if (lake && amplitude) {
        world.waterSurface[vertex] = 10;
        world.waterDepth[vertex] = amplitude;
      }
    }
  const selection: TerrainComponent = {
    kind: lake ? "water" : "relief",
    cells,
    boundary: [],
    threshold: 10,
    truncated: false
  };
  return { world, state, selection };
};

describe("sampled generated terrain transforms (not procedural replacement stamps)", () => {
  it("moves the measured relief, keeps all unselected primary layers, and supports undo/redo", () => {
    const { selection, state, world } = fixture(),
      before = world.heights.slice();
    const paints = world.splat.slice(),
      ore = world.oreAmount.slice(),
      props = world.props.types.slice();
    const provenance = structuredClone(world.generationProvenance);
    const history = createWorldSnapshot(world, state);
    history.capture();
    const result = transformGeneratedFeature(world, state, selection, {
      offsetX: 16,
      offsetZ: 0,
      scale: 1
    });
    expect(result.changed).toBeGreaterThan(0);
    expect(world.heights[22 * 65 + 22]).toBe(10);
    expect(world.heights[22 * 65 + 38]).toBe(11);
    expect(world.heights[8 * 65 + 8]).toBe(before[8 * 65 + 8]);
    expect(world.splat).toEqual(paints);
    expect(world.oreAmount).toEqual(ore);
    expect(world.props.types).toEqual(props);
    expect(world.generationProvenance).toEqual(provenance);
    expect(state.stamps).toHaveLength(0);
    const after = world.heights.slice(),
      diff = history.diff()!;
    applyWorldDiff(world, state, diff, "before");
    expect(world.heights).toEqual(before);
    applyWorldDiff(world, state, diff, "after");
    expect(world.heights).toEqual(after);
  });
  it("moves an inland lake's measured depths without leaving source water", () => {
    const { selection, state, world } = fixture(true);
    transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 });
    expect(world.waterDepth[22 * 65 + 22]).toBe(0);
    expect(world.waterDepth[22 * 65 + 38]).toBe(1);
    expect(world.waterSurface[22 * 65 + 38]).toBe(10);
  });
  it("resizes the real irregular profile and does not raise the centre or change outside terrain", () => {
    const { selection, state, world } = fixture();
    transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 2 });
    expect(world.heights[22 * 65 + 38]).toBe(11);
    expect(world.heights[22 * 65 + 42]).toBeCloseTo(10.5);
    expect(world.heights[3 * 65 + 3]).toBe(10);
  });
  it("refuses protected resources atomically and keeps an existing destination step", () => {
    const { selection, state, world } = fixture();
    world.mineZone[22 * 64 + 38] = 1;
    const before = world.heights.slice();
    expect(() =>
      transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 })
    ).toThrow(/resource/);
    expect(world.heights).toEqual(before);
    expect(state.base).toBeNull();
    world.mineZone.fill(0);
    world.heights[22 * 65 + 42] = 8;
    transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 });
    // The pit beside the landed relief follows it, keeping its own 2-unit step.
    expect(world.heights[22 * 65 + 42]).toBeCloseTo(world.heights[22 * 65 + 41]! - 2);
  });
});

const addFeatureProp = (world: WorldData, type: number, x: number, z: number) =>
  appendProp(world.props, {
    type,
    x,
    z,
    y: sampleSmooth(world, world.heights, x, z),
    form: 0,
    scale: 1.1,
    rotation: 0.7,
    phase: 0.4
  });

describe("generated contour attachment transforms", () => {
  it("moves native trees, rocks and decorations by stable ID, preserves unrelated Y and persists undo/save", async () => {
    const { selection, state, world } = fixture();
    const tree = addFeatureProp(world, PROP.hardwoodTree, 22, 22);
    const rock = addFeatureProp(world, PROP.largeRock, 24, 22);
    const flowers = addFeatureProp(world, PROP.flowers, 21, 24);
    const unrelated = addFeatureProp(world, PROP.bush, 30, 34);
    world.props.y[unrelated] = 99;
    world.authoredTreeAges = { [tree]: 31 };
    const before = structuredClone(world.props),
      ages = structuredClone(world.authoredTreeAges);
    expect(somePropNear(world, 22, 22, 0, (id) => id === tree)).toBe(true);
    const snapshot = createWorldSnapshot(world, state);
    snapshot.capture();
    const result = transformGeneratedFeature(world, state, selection, {
      offsetX: 16,
      offsetZ: 0,
      scale: 1
    });
    expect(result.moved).toEqual([tree, rock, flowers]);
    expect(world.props.count).toBe(before.count);
    for (const id of result.moved) {
      expect(world.props.x[id]).toBe(before.x[id]! + 16);
      expect(world.props.z[id]).toBe(before.z[id]);
      expect(world.props.y[id]).toBeCloseTo(
        sampleSmooth(world, world.heights, world.props.x[id]!, world.props.z[id]!)
      );
    }
    for (const layer of ["types", "form", "scale", "rotation", "phase"] as const)
      expect(world.props[layer]).toEqual(before[layer]);
    expect(world.props.y[unrelated]).toBe(99);
    expect(world.authoredTreeAges).toEqual(ages);
    expect(somePropNear(world, 38, 22, 0, (id) => id === tree)).toBe(true);
    expect(somePropNear(world, 22, 22, 0, (id) => id === tree)).toBe(false);
    const after = structuredClone(world.props),
      diff = snapshot.diff()!;
    applyWorldDiff(world, state, diff, "before");
    expect(world.props.x).toEqual(before.x);
    expect(world.props.y).toEqual(before.y);
    expect(somePropNear(world, 22, 22, 0, (id) => id === tree)).toBe(true);
    applyWorldDiff(world, state, diff, "after");
    expect(world.props.x).toEqual(after.x);
    expect(world.props.y).toEqual(after.y);
    const bytes = await writeMapFile(world, {
      name: "Attached contour",
      source: "generated",
      savedAt: 0,
      animals: [],
      terrain: state
    });
    const loaded = await readMapFile(bytes);
    expect(loaded.world.props.x).toEqual(world.props.x);
    expect(loaded.world.props.y).toEqual(world.props.y);
    expect(loaded.world.authoredTreeAges).toEqual(ages);
  });
  it("moves overlapping footprints simultaneously without duplicating objects", () => {
    const { selection, state, world } = fixture(),
      tree = addFeatureProp(world, PROP.coniferTree, 22, 22);
    const before = world.props.count;
    const result = transformGeneratedFeature(world, state, selection, {
      offsetX: 2,
      offsetZ: 0,
      scale: 1
    });
    expect(result.moved).toEqual([tree]);
    expect(world.props.x[tree]).toBe(24);
    expect(world.props.count).toBe(before);
  });
  it("carries floating and wading plants with a freshwater basin", () => {
    const { selection, state, world } = fixture(true);
    world.heights.forEach((height, vertex) => {
      world.heights[vertex] = height - 8.5;
      if (world.waterSurface[vertex]! > 0) world.waterSurface[vertex] = 1.5;
    });
    world.seaLevel = 0;
    const lily = addFeatureProp(world, PROP.waterLily, 22, 22);
    const reeds = addFeatureProp(world, PROP.reeds, 24.8, 22);
    const result = transformGeneratedFeature(world, state, selection, {
      offsetX: 16,
      offsetZ: 0,
      scale: 1
    });
    expect(result.moved).toEqual([lily, reeds]);
    expect(world.props.x[lily]).toBe(38);
    expect(world.props.y[lily]).toBeCloseTo(1.515);
    expect(world.props.y[reeds]).toBeCloseTo(1.44);
  });
  it("refuses finite-source attachments atomically", () => {
    const { selection, state, world } = fixture(),
      tree = addFeatureProp(world, PROP.coniferTree, 22, 22);
    world.colonyStoneDeposits = [{ id: 0, x: 22, z: 22, remaining: 4, sourceProp: tree }];
    const before = structuredClone(world.props),
      heights = world.heights.slice();
    expect(() =>
      transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 })
    ).toThrow("The finite stone source has an invalid native boulder reference.");
    expect(world.props).toEqual(before);
    expect(world.heights).toEqual(heights);
    expect(state.base).toBeNull();
  });
  it("re-seats a carried tree that a contraction would crowd, keeping both trees", () => {
    const { selection, state, world } = fixture(),
      first = addFeatureProp(world, PROP.coniferTree, 22, 22),
      second = addFeatureProp(world, PROP.coniferTree, 22.8, 22);
    transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 0.5 });
    const gap = Math.hypot(
      world.props.x[first]! - world.props.x[second]!,
      world.props.z[first]! - world.props.z[second]!
    );
    expect(world.props.types[first]).toBe(PROP.coniferTree);
    expect(world.props.types[second]).toBe(PROP.coniferTree);
    expect(gap).toBeGreaterThanOrEqual(0.79);
  });
});

it("refuses active felling/reservations and live actor/path clearance before changing terrain or props", () => {
  for (const active of ["job", "actor", "path"]) {
    const { selection, state, world } = fixture(),
      tree = addFeatureProp(world, PROP.coniferTree, 22, 22);
    const before = structuredClone(world.props),
      heights = world.heights.slice();
    const runtime =
      active === "job"
        ? { canMoveProp: (id: number) => (id === tree ? "Reserved by a worker" : null) }
        : { protectedPoints: [{ x: active === "actor" ? 38 : 22, z: 22, radius: 0.6 }] };
    expect(() =>
      transformGeneratedFeature(
        world,
        state,
        selection,
        { offsetX: 16, offsetZ: 0, scale: 1 },
        runtime
      )
    ).toThrow(/Reserved by a worker|protected/);
    expect(world.props).toEqual(before);
    expect(world.heights).toEqual(heights);
    expect(state.base).toBeNull();
  }
});

it("undo/redo refresh stable moved bodies without resetting growth through removal callbacks", () => {
  const { selection, state, world } = fixture(),
    tree = addFeatureProp(world, PROP.coniferTree, 22, 22);
  const snapshot = createWorldSnapshot(world, state);
  snapshot.capture();
  const result = transformGeneratedFeature(world, state, selection, {
    offsetX: 16,
    offsetZ: 0,
    scale: 1
  });
  const diff = snapshot.diff()!;
  const moved: number[][] = [],
    removed: number[][] = [],
    restored: number[][] = [];
  const rebuild = createHistoryRebuild({
    onPropsMoved: (ids: readonly number[]) => moved.push([...ids]),
    onPropsRemoved: (ids: readonly number[]) => removed.push([...ids]),
    onPropsRestored: (ids: readonly number[]) => restored.push([...ids]),
    terrain: { rebuildArea: () => {} },
    refresher: { afterTerrain: () => {} }
  } as unknown as HistoryRebuildOptions);
  const step = {
    animals: [],
    bytes: diff.bytes,
    diff,
    area: { cells: result.cells, ground: true, mineStones: false, stoneCells: result.cells }
  };
  for (const side of ["before", "after"] as const) {
    const props = applyWorldDiff(world, state, diff, side);
    rebuild(step, side, props);
  }
  expect(moved).toEqual([[tree], [tree]]);
  expect(removed).toEqual([]);
  expect(restored).toEqual([]);
});

it("moves complete finite ore cells and native stone sources with exact identity, amounts and undo", async () => {
  const { selection, state, world } = fixture();
  const oreCells = [21 * 64 + 21, 21 * 64 + 22];
  world.mineZones = [
    { id: 1, ore: 1, richness: 0.8, surveyed: true, cellCount: 2, centreX: 22, centreZ: 21.5 }
  ];
  oreCells.forEach((cell, index) => {
    world.mineZone[cell] = 1;
    world.oreAmount[cell] = [7, 19][index]!;
  });
  const boulder = addFeatureProp(world, PROP.largeRock, 23, 23);
  world.colonyStoneDeposits = [
    { id: 0, x: 23, z: 23, remaining: 17, material: "basalt", sourceProp: boulder }
  ];
  const before = structuredClone({
    zones: world.mineZones,
    deposits: world.colonyStoneDeposits,
    ore: world.oreAmount,
    cells: world.mineZone
  });
  const history = createWorldSnapshot(world, state);
  history.capture();
  const result = transformGeneratedFeature(world, state, selection, {
    offsetX: 16,
    offsetZ: 0,
    scale: 1
  });
  expect(result.movedOreZones).toEqual([1]);
  expect(result.movedStoneDeposits).toEqual([0]);
  for (const [index, cell] of oreCells.entries()) {
    expect(world.mineZone[cell]).toBe(0);
    expect(world.oreAmount[cell]).toBe(0);
    expect(world.mineZone[cell + 16]).toBe(1);
    expect(world.oreAmount[cell + 16]).toBe([7, 19][index]);
  }
  expect(world.mineZones[0]).toEqual({ ...before.zones[0], centreX: 38 });
  expect(world.colonyStoneDeposits).toEqual([{ ...before.deposits[0], x: 39 }]);
  expect(world.props.x[boulder]).toBe(39);
  const diff = history.diff()!;
  applyWorldDiff(world, state, diff, "before");
  expect(world.mineZones).toEqual(before.zones);
  expect(world.mineZone).toEqual(before.cells);
  expect(world.oreAmount).toEqual(before.ore);
  expect(world.colonyStoneDeposits).toEqual(before.deposits);
  applyWorldDiff(world, state, diff, "after");
  expect(world.colonyStoneDeposits?.[0]?.remaining).toBe(17);
  expect(world.colonyStoneDeposits?.[0]?.sourceProp).toBe(boulder);
  const restored = await readMapFile(
    await writeMapFile(world, {
      name: "Finite terrain sources",
      source: "generated",
      savedAt: 0,
      animals: [],
      terrain: state
    })
  );
  expect(restored.world.colonyStoneDeposits).toEqual(world.colonyStoneDeposits);
  expect(restored.world.oreAmount).toEqual(world.oreAmount);
});

it("moves a partly selected ore zone whole, with its exact quantities", () => {
  const { selection, state, world } = fixture();
  world.mineZones = [
    { id: 1, ore: 1, richness: 1, surveyed: false, cellCount: 2, centreX: 22.5, centreZ: 22.5 }
  ];
  world.mineZone[22 * 64 + 22] = world.mineZone[10 * 64 + 10] = 1;
  world.oreAmount[22 * 64 + 22] = 255;
  world.oreAmount[10 * 64 + 10] = 40;
  transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 });
  expect([world.mineZone[22 * 64 + 22], world.mineZone[10 * 64 + 10]]).toEqual([0, 0]);
  expect([world.mineZone[22 * 64 + 38], world.oreAmount[22 * 64 + 38]]).toEqual([1, 255]);
  expect([world.mineZone[10 * 64 + 26], world.oreAmount[10 * 64 + 26]]).toEqual([1, 40]);
});

it("refuses insufficient resized capacity and active finite source jobs atomically", () => {
  for (const reason of ["resize", "reserved"]) {
    const { selection, state, world } = fixture();
    world.mineZones = [
      {
        id: 1,
        ore: 1,
        richness: 1,
        surveyed: false,
        cellCount: reason === "partial" ? 2 : 1,
        centreX: 22.5,
        centreZ: 22.5
      }
    ];
    world.mineZone[22 * 64 + 22] = 1;
    world.oreAmount[22 * 64 + 22] = 255;
    if (reason === "partial") world.mineZone[10 * 64 + 10] = 1;
    if (reason === "resize") {
      for (let z = 20; z <= 23; z++)
        for (let x = 20; x <= 23; x++) {
          world.mineZone[z * 64 + x] = 1;
          world.oreAmount[z * 64 + x] = 255;
        }
      world.mineZones[0]!.cellCount = 16;
    }
    const before = structuredClone(world);
    expect(() =>
      transformGeneratedFeature(
        world,
        state,
        selection,
        { offsetX: 16, offsetZ: 0, scale: reason === "resize" ? 0.5 : 1 },
        { canMoveResource: () => (reason === "reserved" ? "Reserved finite source" : null) }
      )
    ).toThrow(
      reason === "reserved"
        ? "Reserved finite source"
        : "This smaller ore footprint cannot hold its existing quantity."
    );
    expect(world.heights).toEqual(before.heights);
    expect(world.mineZone).toEqual(before.mineZone);
    expect(world.oreAmount).toEqual(before.oreAmount);
    expect(state.base).toBeNull();
  }
});

it("keeps authored finite sources in scenario metadata and refuses their active reservation", () => {
  const { selection, state, world } = fixture();
  world.scenario = {
    ...createMapScenario(),
    kind: "colony",
    marbleDeposits: [{ id: 0, remaining: 9, x: 22, z: 22, material: "limestone" }]
  };
  const before = structuredClone(world.scenario);
  expect(() =>
    transformGeneratedFeature(
      world,
      state,
      selection,
      { offsetX: 16, offsetZ: 0, scale: 1 },
      {
        canMoveResource: (kind, id) =>
          kind === "stone" && id === 0 ? "Reserved finite stone" : null
      }
    )
  ).toThrow(/Reserved/);
  expect(world.scenario).toEqual(before);
  expect(state.base).toBeNull();
  const history = createWorldSnapshot(world, state);
  history.capture();
  transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 });
  expect(world.scenario.marbleDeposits).toEqual([{ ...before.marbleDeposits![0], x: 38 }]);
  const diff = history.diff()!;
  applyWorldDiff(world, state, diff, "before");
  expect(world.scenario).toEqual(before);
  applyWorldDiff(world, state, diff, "after");
  expect(world.scenario?.marbleDeposits?.[0]?.material).toBe("limestone");
});

const containedRiverFixture = (generated = false) => {
  const context = fixture();
  const { world } = context;
  const vertices = [21, 22, 23].map((x) => 22 * 65 + x);
  const patches = vertices.map((vertex) => {
    const before = [
      world.heights[vertex]!,
      world.waterSurface[vertex]!,
      0,
      0,
      0,
      world.riverDistance[vertex]!
    ];
    world.heights[vertex] = 9.8;
    world.waterSurface[vertex] = 10;
    world.waterDepth[vertex] = 10 - world.heights[vertex]!;
    world.flow[vertex * 2] = 1;
    world.riverDistance[vertex] = 0;
    return {
      vertex,
      before,
      after: [world.heights[vertex]!, 10, world.waterDepth[vertex]!, 1, 0, 0]
    };
  });
  // Use a flat matching destination, retaining the source's captured real terrain as its underlay.
  for (const vertex of vertices) patches.find((patch) => patch.vertex === vertex)!.before[0] = 10;
  const river = {
    id: 1,
    points: [21, 22, 23].map((x) => ({ x, z: 22 })),
    width: 1,
    depth: 0.2,
    patches,
    falls: []
  };
  if (generated)
    world.generatedRivers = [
      {
        ...river,
        version: 1,
        mouthStep: 2,
        widthSamples: [1, 1, 1],
        radius: [1, 1, 1],
        profile: [10, 10, 10],
        gorge: [0, 0, 0],
        widthScale: 1,
        depthScale: 1
      }
    ];
  else world.authoredRivers = [river];
  context.selection.kind = "water";
  return { ...context, vertices };
};

it("translates complete generated/authored flowing channels and makes removal restore the actual destination base", async () => {
  const { editAuthoredRiver } = await import("../src/shared/world/editing/authored-rivers");
  const { editGeneratedRiver } = await import("../src/shared/world/editing/generated-river-edit");
  for (const generated of [false, true]) {
    const { selection, state, vertices, world } = containedRiverFixture(generated);
    // Remove the unrelated measured hill: this case exercises exact channel ownership, not a lake approximation.
    for (let vertex = 0; vertex < world.heights.length; vertex++)
      if (!vertices.includes(vertex)) world.heights[vertex] = 10;
    const before = {
      heights: world.heights.slice(),
      surface: world.waterSurface.slice(),
      flow: world.flow.slice(),
      generated: structuredClone(world.generatedRivers),
      authored: structuredClone(world.authoredRivers)
    };
    const history = createWorldSnapshot(world, state);
    history.capture();
    transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 });
    for (const vertex of vertices) {
      expect(world.heights[vertex]).toBe(10);
      expect(world.waterDepth[vertex]).toBe(0);
      expect(world.flow[vertex * 2]).toBe(0);
      expect(world.heights[vertex + 16]).toBeCloseTo(9.8);
      expect(world.flow[(vertex + 16) * 2]).toBe(1);
    }
    const moved = generated ? world.generatedRivers![0]! : world.authoredRivers![0]!;
    expect(moved.id).toBe(1);
    expect(moved.points[0]).toEqual({ x: 37, z: 22 });
    expect(moved.patches.map((patch) => patch.vertex)).toEqual(
      vertices.map((vertex) => vertex + 16)
    );
    expect(moved.patches.every((patch) => patch.before[0] === 10 && patch.before[2] === 0)).toBe(
      true
    );
    const diff = history.diff()!;
    applyWorldDiff(world, state, diff, "before");
    expect(world.heights).toEqual(before.heights);
    expect(world.flow).toEqual(before.flow);
    expect(world.generatedRivers).toEqual(before.generated);
    expect(world.authoredRivers).toEqual(before.authored);
    applyWorldDiff(world, state, diff, "after");
    if (generated) editGeneratedRiver(world, null, 1);
    else editAuthoredRiver(world, null, 1);
    for (const vertex of vertices) {
      expect(world.heights[vertex]).toBe(10);
      expect(world.heights[vertex + 16]).toBe(10);
      expect(world.waterDepth[vertex + 16]).toBe(0);
    }
  }
});

it("refuses partial flowing groups, resizing, incompatible destination grade and map-space erasures atomically", () => {
  for (const reason of ["partial", "resize", "grade", "erasures"]) {
    const { selection, state, vertices, world } = containedRiverFixture();
    for (let vertex = 0; vertex < world.heights.length; vertex++)
      if (!vertices.includes(vertex)) world.heights[vertex] = 10;
    if (reason === "partial") selection.cells = selection.cells.filter((cell) => cell % 64 <= 21);
    if (reason === "grade") world.heights[vertices[0]! + 16] = 11;
    if (reason === "erasures") world.authoredRivers![0]!.suppressedVertices = [1];
    const before = structuredClone(world);
    expect(() =>
      transformGeneratedFeature(world, state, selection, {
        offsetX: 16,
        offsetZ: 0,
        scale: reason === "resize" ? 1.5 : 1
      })
    ).toThrow(/complete.*channel|resiz|grade|erasure|map-space/);
    expect(world.heights).toEqual(before.heights);
    expect(world.flow).toEqual(before.flow);
    expect(world.authoredRivers).toEqual(before.authoredRivers);
    expect(state.base).toBeNull();
  }
});

it("retains generated grade and waterfall geometry under a consistent destination height offset", () => {
  const { selection, state, vertices, world } = containedRiverFixture(true);
  for (let vertex = 0; vertex < world.heights.length; vertex++)
    if (!vertices.includes(vertex)) world.heights[vertex] = 10;
  for (let z = 17; z <= 27; z++) for (let x = 34; x <= 42; x++) world.heights[z * 65 + x] = 12;
  const fall = {
    x: 22,
    z: 22,
    poolX: 23,
    poolZ: 22,
    poolRadius: 1,
    width: 1,
    top: 10,
    bottom: 9.8,
    directionX: 1,
    directionZ: 0
  };
  world.generatedRivers![0]!.falls = [fall];
  world.waterfalls = [fall];
  transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0, scale: 1 });
  const moved = world.generatedRivers![0]!;
  expect(moved.profile).toEqual([12, 12, 12]);
  expect(moved.falls).toEqual([{ ...fall, x: 38, poolX: 39, top: 12, bottom: 11.8 }]);
  expect(world.waterfalls).toEqual(moved.falls);
  expect(moved.patches.every((patch) => patch.before[0] === 12)).toBe(true);
  for (const vertex of vertices) {
    expect(world.heights[vertex]).toBe(10);
    expect(world.heights[vertex + 16]).toBeCloseTo(11.8);
    expect(world.waterSurface[vertex + 16]).toBe(12);
  }
});

it("resizes ore geology deterministically while conserving every finite unit and stable survey identity", () => {
  for (const scale of [0.5, 2]) {
    const first = fixture(),
      second = fixture();
    for (const { world } of [first, second]) {
      world.oreAmount.fill(0);
      world.mineZones = [
        { id: 1, ore: 1, richness: 0.8, surveyed: true, cellCount: 4, centreX: 22, centreZ: 22 }
      ];
      for (const [index, cell] of [
        21 * 64 + 21,
        21 * 64 + 22,
        22 * 64 + 21,
        22 * 64 + 22
      ].entries()) {
        world.mineZone[cell] = 1;
        world.oreAmount[cell] = [7, 19, 33, 41][index]!;
      }
    }
    for (const { selection, state, world } of [first, second])
      transformGeneratedFeature(world, state, selection, { offsetX: 16, offsetZ: 0.25, scale });
    expect(first.world.oreAmount).toEqual(second.world.oreAmount);
    expect(first.world.mineZone).toEqual(second.world.mineZone);
    expect(first.world.oreAmount.reduce((sum, amount) => sum + amount, 0)).toBe(100);
    expect(first.world.mineZones[0]).toMatchObject({
      id: 1,
      ore: 1,
      richness: 0.8,
      surveyed: true
    });
    expect(first.world.mineZones[0]!.cellCount).toBe(
      [...first.world.mineZone].filter((id) => id === 1).length
    );
  }
});

it("recarves a complete resized native river group with atomic saved underlay and undo", async () => {
  const { selection, state, vertices, world } = containedRiverFixture(true);
  for (let v = 0; v < world.heights.length; v++) if (!vertices.includes(v)) world.heights[v] = 10;
  const history = createWorldSnapshot(world, state);
  history.capture();
  const before = world.heights.slice();
  transformGeneratedFeature(world, state, selection, {
    offsetX: 16,
    offsetZ: 0,
    scale: 1.5,
    includeRivers: true
  });
  const moved = world.generatedRivers![0]!;
  expect(moved.id).toBe(1);
  expect(moved.widthSamples.every((width) => width === 1.5)).toBe(true);
  expect(moved.patches.length).toBeGreaterThan(0);
  expect(moved.patches.every((patch) => patch.before[0] === 10)).toBe(true);
  for (const v of vertices) expect(world.heights[v]).toBe(10);
  const after = world.heights.slice(),
    diff = history.diff()!;
  applyWorldDiff(world, state, diff, "before");
  expect(world.heights).toEqual(before);
  applyWorldDiff(world, state, diff, "after");
  expect(world.heights).toEqual(after);
  const saved = await readMapFile(
    await writeMapFile(world, {
      name: "Resized native group",
      source: "generated",
      savedAt: 0,
      animals: [],
      terrain: state
    })
  );
  expect(saved.world.generatedRivers).toEqual(world.generatedRivers);
  const { editGeneratedRiver } = await import("../src/shared/world/editing/generated-river-edit");
  editGeneratedRiver(world, null, 1);
  for (const patch of moved.patches) expect(world.heights[patch.vertex]).toBe(10);
});

it("moves and resizes measured mountain underlay together with a complete native authored course", async () => {
  const { applyAuthoredRiver, editAuthoredRiver } =
    await import("../src/shared/world/editing/authored-rivers");
  for (const scale of [1, 1.5]) {
    const { selection, state, world } = fixture();
    const originalRelief = world.heights.slice();
    const river = {
      id: 1,
      width: 1,
      depth: 0.3,
      points: [
        { x: 22, z: 22 },
        { x: 20, z: 22 }
      ],
      patches: [],
      falls: []
    };
    applyAuthoredRiver(world, river);
    world.authoredRivers = [river];
    const { removeRiverGroup } =
      await import("../src/shared/world/editing/terrain/generated-feature-river-group");
    const underlay = removeRiverGroup(structuredClone(world), [{ generated: false, river }]);
    expect(underlay.heights[22 * 65 + 22]).toBe(originalRelief[22 * 65 + 22]);
    const nativeBefore = world.heights.slice();
    const history = createWorldSnapshot(world, state);
    history.capture();
    transformGeneratedFeature(world, state, selection, {
      offsetX: 24,
      offsetZ: 0,
      scale,
      includeRivers: true
    });
    expect(world.authoredRivers![0]!.id).toBe(1);
    expect(world.authoredRivers![0]!.width).toBe(scale);
    expect(world.authoredRivers![0]!.points[0]).toEqual({ x: 46, z: 22 });
    expect(world.heights[22 * 65 + 22]).toBe(10);
    const carved = world.authoredRivers![0]!.patches;
    expect(carved.length).toBeGreaterThan(0);
    const diff = history.diff()!;
    applyWorldDiff(world, state, diff, "before");
    expect(world.heights).toEqual(nativeBefore);
    applyWorldDiff(world, state, diff, "after");
    editAuthoredRiver(world, null, 1);
    expect(world.heights[22 * 65 + 46]).toBe(originalRelief[22 * 65 + 22]);
    expect(world.heights[22 * 65 + 22]).toBe(10);
  }
});

it("keeps overlapping canonical river order, fixed map erasures and adopted depth identity during group resize", async () => {
  const { applyAuthoredRiver } = await import("../src/shared/world/editing/authored-rivers");
  const { selection, state, world } = fixture();
  world.heights.fill(10);
  const rivers = [
    {
      id: 1,
      width: 1,
      depth: 0.3,
      points: [
        { x: 22, z: 22 },
        { x: 20, z: 22 }
      ],
      patches: [],
      falls: [],
      suppressedVertices: [22 * 65 + 22]
    },
    {
      id: 2,
      width: 1,
      depth: 0.3,
      points: [
        { x: 22, z: 22 },
        { x: 22, z: 20 }
      ],
      patches: [],
      falls: []
    }
  ];
  for (const river of rivers) applyAuthoredRiver(world, river);
  world.authoredRivers = rivers;
  selection.kind = "water";
  transformGeneratedFeature(world, state, selection, {
    offsetX: 24,
    offsetZ: 8,
    scale: 1.2,
    includeRivers: true
  });
  expect(world.authoredRivers!.map((river) => river.id)).toEqual([1, 2]);
  expect(world.authoredRivers![0]!.suppressedVertices).toEqual([22 * 65 + 22]);
  const first = new Set(world.authoredRivers![0]!.patches.map((patch) => patch.vertex));
  expect(world.authoredRivers![1]!.patches.some((patch) => first.has(patch.vertex))).toBe(true);
  const {
    selection: adoptedSelection,
    state: adoptedState,
    vertices,
    world: adopted
  } = containedRiverFixture(true);
  for (let v = 0; v < adopted.heights.length; v++)
    if (!vertices.includes(v)) adopted.heights[v] = 10;
  adopted.generatedRivers![0]!.adopted = true;
  adopted.generatedRivers![0]!.bedDepthSamples = [0.2, 0.3, 0.4];
  transformGeneratedFeature(adopted, adoptedState, adoptedSelection, {
    offsetX: 16,
    offsetZ: 0,
    scale: 1.5,
    includeRivers: true
  });
  const moved = adopted.generatedRivers![0]!;
  expect(moved.adopted).toBe(true);
  expect(moved.bedDepthSamples).toHaveLength(moved.points.length);
  expect(moved.bedDepthSamples![0]).toBe(0.2);
  expect(moved.bedDepthSamples!.at(-1)).toBe(0.4);
});

it("refuses recomposed destination resources and active jobs without any source or history mutation", async () => {
  const { applyAuthoredRiver } = await import("../src/shared/world/editing/authored-rivers");
  for (const kind of ["source", "job"]) {
    const { selection, state, world } = fixture();
    const river = {
      id: 1,
      width: 1,
      depth: 0.3,
      points: [
        { x: 22, z: 22 },
        { x: 20, z: 22 }
      ],
      patches: [],
      falls: []
    };
    applyAuthoredRiver(world, river);
    world.authoredRivers = [river];
    if (kind === "source")
      world.colonyStoneDeposits = [{ id: 0, remaining: 19, x: 46, z: 22, material: "marble" }];
    const before = structuredClone(world),
      beforeState = structuredClone(state);
    expect(() =>
      transformGeneratedFeature(
        world,
        state,
        selection,
        { offsetX: 24, offsetZ: 0, scale: 1.5, includeRivers: true },
        kind === "job" ? { protectedPoints: [{ x: 46, z: 22 }] } : undefined
      )
    ).toThrow(/unrelated prop, resource, road|protected/);
    expect(world.heights).toEqual(before.heights);
    expect(world.waterDepth).toEqual(before.waterDepth);
    expect(world.flow).toEqual(before.flow);
    expect(world.props).toEqual(before.props);
    expect(world.authoredRivers).toEqual(before.authoredRivers);
    expect(world.colonyStoneDeposits).toEqual(before.colonyStoneDeposits);
    expect(state).toEqual(beforeState);
  }
});

it("supports the native128 editor acceptance fixture with finite ore, source boulder and birch identity", async () => {
  const { createEditorTransformFixture } = await import("../tools/bench/editor-transform-fixture");
  const { extractTerrainComponent } =
    await import("../src/shared/world/editing/terrain/terrain-component");
  const world = createEditorTransformFixture(
    cachedWorld({
      ...DEFAULT_WORLD_OPTIONS,
      cellsX: 128,
      cellsZ: 128,
      seed: 1234,
      forest: 0,
      mountains: 0,
      rivers: 0,
      erosionDroplets: 0
    })
  );
  const { createIslandNav } = await import("../src/render-common/wildlife/nav/island-nav");
  const { findStandSpot, WORKER_NAV_SPECIES } =
    await import("../src/render-common/workers/worker-unit");
  const { createWorkerNav } = await import("../src/render-common/workers/worker-nav");
  const { buildIslandRockBodies } = await import("../src/render-common/rocks/island-rocks");
  const { createVertexFog } = await import("../src/render-common/chunk-sampling");
  const rocks = buildIslandRockBodies(world, createVertexFog(world));
  expect(
    findStandSpot(
      createWorkerNav(world, createIslandNav(world, rocks.placed), WORKER_NAV_SPECIES).nav,
      world.start.x,
      world.start.z
    )
  ).not.toBeNull();
  const state = createTerrainEditState();
  const selection = extractTerrainComponent(world, { x: 48, z: 48 }, "relief", 1.1)!;
  expect(selection).not.toBeNull();
  expect(selection.truncated).toBe(false);
  const result = transformGeneratedFeature(world, state, selection, {
    offsetX: 32,
    offsetZ: 0,
    scale: 1.5,
    includeRivers: true
  });
  expect(result.movedOreZones).toEqual([1]);
  expect(result.movedStoneDeposits).toEqual([0]);
  expect(result.moved).toEqual([0, 1]);
  expect(world.oreAmount.reduce((sum, amount) => sum + amount, 0)).toBe(100);
  expect(world.props.form[1]).toBe(7);
});

it("guards cubic relief contacts outside selected prop anchor cells before composing courses", () => {
  const { selection, state, world } = containedRiverFixture(true);
  selection.kind = "relief";
  selection.cells = selection.cells.filter((cell) => cell % world.cellsX !== 25);
  const tree = addFeatureProp(world, PROP.coniferTree, 25.5, 22);
  expect(selection.cells).not.toContain(22 * 64 + 25);
  expect(world.heights[22 * 65 + 25]).toBeGreaterThan(selection.threshold);
  const before = structuredClone(world.props);
  expect(() =>
    transformGeneratedFeature(
      world,
      state,
      selection,
      { offsetX: 16, offsetZ: 0, scale: 1.5, includeRivers: true },
      { canMoveProp: (id) => (id === tree ? "Reserved cubic-contact tree" : null) }
    )
  ).toThrow("Reserved cubic-contact tree");
  expect(world.props).toEqual(before);
  expect(state.base).toBeNull();
});

it("keeps dry contour transforms usable when river inclusion is enabled without a selected course", () => {
  const { selection, state, world } = fixture();
  world.authoredRivers = [
    {
      id: 1,
      width: 1,
      depth: 0.3,
      points: [
        { x: 6, z: 6 },
        { x: 7, z: 6 }
      ],
      patches: [{ vertex: 6 * 65 + 6, before: [10, 0, 0, 0, 0, 0], after: [10, 0, 0, 0, 0, 0] }],
      falls: []
    }
  ];
  const rivers = structuredClone(world.authoredRivers);
  const result = transformGeneratedFeature(world, state, selection, {
    offsetX: 16,
    offsetZ: 0,
    scale: 1,
    includeRivers: true
  });
  expect(result.changed).toBeGreaterThan(0);
  expect(world.heights[22 * 65 + 38]).toBe(11);
  expect(world.authoredRivers).toEqual(rivers);
});

it("still refuses flowing relief without an editable complete course when river inclusion is enabled", () => {
  const { selection, state, world } = fixture();
  const vertex = 22 * 65 + 22;
  world.waterDepth[vertex] = 0.2;
  world.flow[vertex * 2] = 1;
  const before = world.heights.slice();
  expect(() =>
    transformGeneratedFeature(world, state, selection, {
      offsetX: 1,
      offsetZ: 0,
      scale: 1,
      includeRivers: true
    })
  ).toThrow("Select an editable complete course, or adopt its baked river first.");
  expect(world.heights).toEqual(before);
});

const reliefRiverFixture = async () => {
  const { applyAuthoredRiver } = await import("../src/shared/world/editing/authored-rivers");
  const context = fixture();
  const river = {
    id: 1,
    width: 1,
    depth: 0.3,
    points: [
      { x: 22, z: 22 },
      { x: 20, z: 22 }
    ],
    patches: [],
    falls: []
  };
  applyAuthoredRiver(context.world, river);
  context.world.authoredRivers = [river];
  return context;
};

it("refuses relief containing a flowing river when complete courses are not included", async () => {
  const { selection, state, world } = await reliefRiverFixture();
  const before = {
    heights: world.heights.slice(),
    waterSurface: world.waterSurface.slice(),
    waterDepth: world.waterDepth.slice(),
    flow: world.flow.slice(),
    authoredRivers: structuredClone(world.authoredRivers)
  };
  expect(() =>
    transformGeneratedFeature(world, state, selection, {
      offsetX: 16,
      offsetZ: 0,
      scale: 1,
      includeRivers: false
    })
  ).toThrow("Include the complete connected river course");
  expect(world.heights).toEqual(before.heights);
  expect(world.waterSurface).toEqual(before.waterSurface);
  expect(world.waterDepth).toEqual(before.waterDepth);
  expect(world.flow).toEqual(before.flow);
  expect(world.authoredRivers).toEqual(before.authoredRivers);
  expect(state.base).toBeNull();
});

it("still moves a complete river with its relief when complete courses are included", async () => {
  const { selection, state, world } = await reliefRiverFixture();
  transformGeneratedFeature(world, state, selection, {
    offsetX: 16,
    offsetZ: 0,
    scale: 1,
    includeRivers: true
  });
  const moved = world.authoredRivers![0]!;
  expect(moved.points[0]).toEqual({ x: 38, z: 22 });
  expect(moved.patches.length).toBeGreaterThan(0);
  const destination = 22 * 65 + 38;
  expect(world.waterDepth[destination]).toBeGreaterThan(0);
  expect(
    Math.hypot(world.flow[destination * 2]!, world.flow[destination * 2 + 1]!)
  ).toBeGreaterThan(0);
});

it("keeps dry relief transforms working when complete courses are not included", () => {
  const { selection, state, world } = fixture();
  const result = transformGeneratedFeature(world, state, selection, {
    offsetX: 16,
    offsetZ: 0,
    scale: 1,
    includeRivers: false
  });
  expect(result.changed).toBeGreaterThan(0);
  expect(world.heights[22 * 65 + 38]).toBe(11);
});
