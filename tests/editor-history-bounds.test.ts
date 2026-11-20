import { describe, expect, it } from "vitest";

import { createEditorHistory } from "../src/app/map-editor/editor-history";
import {
  applyWorldDiff,
  createWorldSnapshot,
  type WorldEditScope
} from "../src/shared/world/editing/history/world-diff";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { appendProp } from "../src/shared/world/editing/prop-set";
import {
  applyStampChanges,
  getTerrainApplyRegion
} from "../src/shared/world/editing/terrain/terrain-apply";
import type { TerrainBrushStroke } from "../src/shared/world/editing/terrain/terrain-brush";
import {
  createTerrainEditState,
  raiseStampAt,
  removeStampsNear,
  type StampChange,
  type TerrainEditState
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getCircleRegion } from "../src/shared/world/grid-geometry";
import { BUILD, PROP, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";
import { diffSnapshots, snapshotState } from "./state-diff";

const SIZES = [256, 512] as const;
const OPTIONS = (size: number) =>
  ({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, erosionDroplets: 8000, seed: 123 });
const worldOf = (size: number) => cachedWorld(OPTIONS(size));

preloadWorlds(...SIZES.map(OPTIONS));

/** Every tracked prop array; a prop edit keeps the whole (small) list under full scan. */
const PROP_LAYERS = ["props.types", "props.form", "props.x", "props.y", "props.z", "props.rotation",
  "props.scale", "props.phase"];

/** A dry inland large-building spot; `edge` puts it on a 32-cell chunk boundary. */
const findSpot = (world: WorldData, edge = false, away?: { x: number; z: number }, distance = 0) => {
  for (let z = 20; z < world.cellsZ - 20; z += 1) {
    for (let x = 20; x < world.cellsX - 20; x += 1) {
      if (edge && x % 32 !== 31 && z % 32 !== 31) continue;
      if (away && Math.hypot(x + .5 - away.x, z + .5 - away.z) < distance) continue;
      const vertex = z * (world.cellsX + 1) + x;
      if (world.buildClass[z * world.cellsX + x] !== BUILD.large) continue;
      if (world.coastDistance[vertex]! <= 14 || world.riverDistance[vertex]! <= 18) continue;
      return { x: x + 0.5, z: z + 0.5 };
    }
  }
  throw new Error("no dry inland edit spot");
};

/** A wet cell next to dry ground (a brush there changes the water field). */
const findCoastSpot = (world: WorldData) => {
  for (let z = 4; z < world.cellsZ - 4; z += 1) {
    for (let x = 4; x < world.cellsX - 4; x += 1) {
      const cell = z * world.cellsX + x;
      if (world.waterDepth[cell]! < .5) continue;
      if (world.waterDepth[cell - 2]! > .05 || world.waterDepth[cell + 2]! > .05 ||
        world.waterDepth[cell + world.cellsX * 2]! > .05 || world.waterDepth[cell - world.cellsX * 2]! > .05)
        continue;
      return { x: x + .5, z: z + .5 };
    }
  }
  throw new Error("no coast spot");
};

interface Plan {
  brushes: TerrainBrushStroke[];
  changes: StampChange[];
}

type Planner = (world: WorldData, state: TerrainEditState) => Plan;

/** Applies one planner result; the planner may change the stamp list (as a real click does). */
const run = (world: WorldData, state: TerrainEditState, plan: Plan,
  ground: ReturnType<typeof applyStampChanges>["ground"] | null = null) =>
  applyStampChanges(world, state, plan.changes, ground, plan.brushes);

/** Measures the exact edit bounds with a throwaway copy, before the real planner changes state. */
const scopeOf = (world: WorldData, state: TerrainEditState, planner: Planner): WorldEditScope => {
  const plan = planner(world, structuredClone(state));
  return { cells: getTerrainApplyRegion(world, state, plan.changes, plan.brushes), waterChanged: true };
};

const stateOf = (world: WorldData, terrain: TerrainEditState) =>
  snapshotState({ terrain, world });

const expectSameState = (actual: WorldData, actualState: TerrainEditState,
  expected: WorldData, expectedState: TerrainEditState, context: string) => {
  expect(diffSnapshots(stateOf(actual, actualState), stateOf(expected, expectedState)), context)
    .toEqual([]);
};

/** Runs the same edit twice: the original full snapshot and a snapshot bounded to its cells. */
const compareSnapshot = (size: number, planner: Planner, context: string) => {
  const world = worldOf(size), state = createTerrainEditState();
  const legacyWorld = worldOf(size), legacyState = createTerrainEditState();
  const scope = scopeOf(world, state, planner);
  const bounded = createWorldSnapshot(world, state);
  bounded.capture(scope);
  const legacy = createWorldSnapshot(legacyWorld, legacyState);
  legacy.capture();

  run(world, state, planner(world, state));
  run(legacyWorld, legacyState, planner(legacyWorld, legacyState));
  const boundedDiff = bounded.diff()!;
  const legacyDiff = legacy.diff()!;
  expect(boundedDiff, `${context}: diff`).toEqual(legacyDiff);

  applyWorldDiff(world, state, boundedDiff, "before");
  applyWorldDiff(legacyWorld, legacyState, legacyDiff, "before");
  expectSameState(world, state, legacyWorld, legacyState, `${context}: undo`);
  applyWorldDiff(world, state, boundedDiff, "after");
  applyWorldDiff(legacyWorld, legacyState, legacyDiff, "after");
  expectSameState(world, state, legacyWorld, legacyState, `${context}: redo`);
  return true;
};

/** The same non-terrain world mutation with a bounded and a full snapshot. */
const compareMutation = (
  size: number,
  scopeFor: (world: WorldData) => WorldEditScope,
  mutate: (world: WorldData) => void,
  context: string
) => {
  const world = worldOf(size), legacyWorld = worldOf(size);
  const bounded = createWorldSnapshot(world, null);
  bounded.capture(scopeFor(world));
  const legacy = createWorldSnapshot(legacyWorld, null);
  legacy.capture();
  mutate(world);
  mutate(legacyWorld);
  const boundedDiff = bounded.diff()!;
  const legacyDiff = legacy.diff()!;
  expect(boundedDiff, `${context}: diff`).toEqual(legacyDiff);
  applyWorldDiff(world, null, boundedDiff, "before");
  applyWorldDiff(legacyWorld, null, legacyDiff, "before");
  expectSameState(world, createTerrainEditState(), legacyWorld, createTerrainEditState(),
    `${context}: undo`);
  applyWorldDiff(world, null, boundedDiff, "after");
  applyWorldDiff(legacyWorld, null, legacyDiff, "after");
  expectSameState(world, createTerrainEditState(), legacyWorld, createTerrainEditState(),
    `${context}: redo`);
  return true;
};

describe("bounded world history", () => {
  for (const size of SIZES) {
    it(`matches the full diff and undo/redo for mountains on a chunk edge on ${size}²`, () => {
      const world = worldOf(size);
      const spot = findSpot(world, true);
      expect(compareSnapshot(size, (claimWorld, state) => ({
        brushes: [], changes: [raiseStampAt(state, spot.x, spot.z, 51)]
      }), `${size}² mountain`)).toBe(true);
    }, 30_000);
  }

  for (const size of SIZES) {
    it(`matches the full diff and undo/redo for lakes and water changes on ${size}²`, () => {
      const world = worldOf(size);
      const spot = findSpot(world);
      expect(compareSnapshot(size, (claimWorld, state) => ({
        brushes: [], changes: [raiseStampAt(state, spot.x, spot.z, 9, "lake")]
      }), `${size}² lake`)).toBe(true);

      const coast = findCoastSpot(world);
      expect(compareSnapshot(size, () => ({
        brushes: [{ ...coast, mode: "sea", radius: 4, strength: 1 }], changes: []
      }), `${size}² water brush`)).toBe(true);
    }, 30_000);
  }

  for (const size of SIZES) {
    it(`matches the full diff and undo/redo for props and rocks on ${size}²`, () => {
      const world = worldOf(size), spot = findSpot(world);
      expect(compareMutation(size, () => ({
        cells: getCircleRegion(world, spot.x, spot.z, 16), waterChanged: false
      }), (target) => {
        const placed = placeProp(target, { kind: PROP.broadleafTree, seed: 7, x: spot.x, z: spot.z });
        if (typeof placed === "string") throw new Error(placed);
      }, `${size}² tree`)).toBe(true);
    }, 30_000);
  }

  for (const size of SIZES) {
    it(`matches the full diff for a brush at the map edge on ${size}²`, () => {
      expect(compareSnapshot(size, () => ({
        brushes: [{ x: .5, z: .5, mode: "reset", radius: 5, strength: 1 }], changes: []
      }), `${size}² map edge`)).toBe(true);
    }, 30_000);
  }

  for (const size of SIZES) {
    it(`matches the full diff for a brush baking an existing stamp on ${size}²`, () => {
      const world = worldOf(size), state = createTerrainEditState();
      const legacyWorld = worldOf(size), legacyState = createTerrainEditState();
      const spot = findSpot(world, true);
      // Two overlapping peaks: resetting the ground bakes their whole footprints out of the
      // terrain tool's base arrays, beyond the reset brush cells.
      for (const target of [world, legacyWorld]) {
        const claim = target === world ? state : legacyState;
        for (let level = 0; level < 3; level += 1)
          applyStampChanges(target, claim, [raiseStampAt(claim, spot.x, spot.z, 41)]);
        applyStampChanges(target, claim, [raiseStampAt(claim, spot.x + 5, spot.z, 42)]);
      }
      const brush: TerrainBrushStroke = { ...spot, radius: 8, mode: "reset", strength: 1 };
      const scope = { cells: getTerrainApplyRegion(world, state, [], [brush]), waterChanged: true };
      const bounded = createWorldSnapshot(world, state);
      bounded.capture(scope);
      const legacy = createWorldSnapshot(legacyWorld, legacyState);
      legacy.capture();
      const applied = applyStampChanges(world, state, [], null, [brush]);
      applyStampChanges(legacyWorld, legacyState, [], null, [brush]);
      const boundedDiff = bounded.diff()!;
      const legacyDiff = legacy.diff()!;
      expect(boundedDiff, `${size}² baked stamp: diff`).toEqual(legacyDiff);
      expect(applied.ground).toBeTruthy();
      applyWorldDiff(world, state, boundedDiff, "before");
      applyWorldDiff(legacyWorld, legacyState, legacyDiff, "before");
      expectSameState(world, state, legacyWorld, legacyState, `${size}² baked stamp undo`);
      applyWorldDiff(world, state, boundedDiff, "after");
      applyWorldDiff(legacyWorld, legacyState, legacyDiff, "after");
      expectSameState(world, state, legacyWorld, legacyState, `${size}² baked stamp redo`);
    }, 30_000);
  }

  for (const size of SIZES) {
    it(`matches the full diff for adding, growing and removing a stamp on ${size}²`, () => {
      const world = worldOf(size), state = createTerrainEditState();
      const legacyWorld = worldOf(size), legacyState = createTerrainEditState();
      const spot = findSpot(world, true);
      const grow: Planner = (_world, claim) => ({
        brushes: [], changes: [raiseStampAt(claim, spot.x, spot.z, 21)]
      });

      // First capture with the add bounds, then grow the same stamp inside the same step.
      const addScope = scopeOf(world, state, grow);
      const bounded = createWorldSnapshot(world, state);
      bounded.capture(addScope);
      const legacy = createWorldSnapshot(legacyWorld, legacyState);
      legacy.capture();
      run(world, state, grow(world, state));
      run(legacyWorld, legacyState, grow(legacyWorld, legacyState));
      const growScope = scopeOf(world, state, grow);
      bounded.captureLayers(growScope);
      run(world, state, grow(world, state));
      run(legacyWorld, legacyState, grow(legacyWorld, legacyState));

      const growDiff = bounded.diff()!;
      const legacyGrowDiff = legacy.diff()!;
      expect(growDiff).toEqual(legacyGrowDiff);
      applyWorldDiff(world, state, growDiff, "before");
      applyWorldDiff(legacyWorld, legacyState, legacyGrowDiff, "before");
      expectSameState(world, state, legacyWorld, legacyState, `${size}² grow undo`);

      applyWorldDiff(world, state, growDiff, "after");
      applyWorldDiff(legacyWorld, legacyState, legacyGrowDiff, "after");
      expectSameState(world, state, legacyWorld, legacyState, `${size}² grow redo`);

      const removal: Planner = (_world, claim) => ({
        brushes: [], changes: removeStampsNear(claim, spot.x, spot.z, 24)
      });
      const removalScope = scopeOf(world, state, removal);
      const removalBounded = createWorldSnapshot(world, state);
      removalBounded.capture(removalScope);
      const removalLegacy = createWorldSnapshot(legacyWorld, legacyState);
      removalLegacy.capture();
      run(world, state, removal(world, state));
      run(legacyWorld, legacyState, removal(legacyWorld, legacyState));
      const removalDiff = removalBounded.diff()!;
      const legacyRemovalDiff = removalLegacy.diff()!;
      expect(removalDiff).toEqual(legacyRemovalDiff);
      applyWorldDiff(world, state, removalDiff, "before");
      applyWorldDiff(legacyWorld, legacyState, legacyRemovalDiff, "before");
      expectSameState(world, state, legacyWorld, legacyState, `${size}² removal undo`);
    });
  }
});

interface HistorySession {
  ground: ReturnType<typeof applyStampChanges>["ground"] | null;
  history: ReturnType<typeof createEditorHistory>;
  state: TerrainEditState;
  world: WorldData;
}

const createSession = (size: number): HistorySession => {
  const world = worldOf(size), state = createTerrainEditState();
  return {
    ground: null, state, world,
    history: createEditorHistory({
      animals: { list: () => [], place: () => true, remove: () => {} },
      flush: () => {},
      isQueued: () => false,
      rebuild: () => {},
      terrain: state,
      world
    })
  };
};

/** One pointer stroke: bounded sessions capture each edit's actual bounds as they come. */
const stroke = (session: HistorySession, planners: readonly Planner[], bounded: boolean) => {
  const { history, state, world } = session;
  if (!bounded) history.begin();
  for (const planner of planners) {
    if (bounded) history.begin(scopeOf(world, state, planner));
    session.ground = run(world, state, planner(world, state), session.ground).ground;
  }
  history.endStroke();
};

describe("deferred terrain history capture", () => {
  for (const size of SIZES) {
    it(`keeps the terrain stamps captured before a queued click and restores it on ${size}²`, () => {
      const bounded = createSession(size), legacy = createSession(size);
      const spot = findSpot(bounded.world);
      const planner: Planner = (_world, state) => ({
        brushes: [], changes: [raiseStampAt(state, spot.x, spot.z, 31, "lake")]
      });

      // The editor opens the stroke on pointer down (metadata now), the queued click changes the
      // stamps, and the terrain tool captures the world layers just before applying the batch.
      bounded.history.begin(undefined, { deferLayers: true });
      const boundedChange = planner(bounded.world, bounded.state).changes[0]!;
      bounded.history.capture({ cells: getTerrainApplyRegion(bounded.world, bounded.state, [boundedChange]),
        waterChanged: true });
      const boundedApplied = applyStampChanges(bounded.world, bounded.state, [boundedChange]);
      bounded.ground = boundedApplied.ground;
      bounded.history.endStroke();

      legacy.history.begin();
      const legacyChange = planner(legacy.world, legacy.state).changes[0]!;
      const legacyApplied = applyStampChanges(legacy.world, legacy.state, [legacyChange]);
      legacy.ground = legacyApplied.ground;
      legacy.history.endStroke();

      expectSameState(bounded.world, bounded.state, legacy.world, legacy.state, `${size}² applied`);
      expect(bounded.history.stats()).toEqual(legacy.history.stats());
      bounded.history.undo(); legacy.history.undo();
      expectSameState(bounded.world, bounded.state, legacy.world, legacy.state, `${size}² deferred undo`);
      bounded.history.redo(); legacy.history.redo();
      expectSameState(bounded.world, bounded.state, legacy.world, legacy.state, `${size}² deferred redo`);
    });
  }
});

describe("unbounded derived layers", () => {
  it("still captures global water/river state and props outside a local scope", () => {
    const world = worldOf(256), spot = findSpot(world);
    const original = {
      coastDistance: world.coastDistance.slice(), flow: world.flow.slice(),
      riverDistance: world.riverDistance.slice(), wetRock: world.wetRock.slice()
    };
    const snapshot = createWorldSnapshot(world, null);
    snapshot.capture({ cells: getCircleRegion(world, spot.x, spot.z, 3), waterChanged: true });
    const propCount = world.props.count;
    const far = world.cellsX * 10 + 10;
    world.coastDistance[far] = world.coastDistance[far]! + 1;
    world.flow[far * 2] = world.flow[far * 2]! + 1;
    world.riverDistance[far] = world.riverDistance[far]! + 1;
    world.wetRock[far] = world.wetRock[far]! + 1;
    appendProp(world.props, { form: 0, phase: 0, rotation: 0, scale: 1, type: PROP.smallRock,
      x: 2.5, y: 1, z: 2.5 });

    const diff = snapshot.diff()!;
    const names = new Set(diff.layers.map((layer) => layer.name));
    expect(names).toEqual(new Set(["coastDistance", "flow", "riverDistance", "wetRock", ...PROP_LAYERS]));
    applyWorldDiff(world, null, diff, "before");
    expect(world.coastDistance).toEqual(original.coastDistance);
    expect(world.flow).toEqual(original.flow);
    expect(world.riverDistance).toEqual(original.riverDistance);
    expect(world.wetRock).toEqual(original.wetRock);
    expect(world.props.count).toBe(propCount);
  });
});

describe("bounded multi-stroke history", () => {
  for (const size of SIZES) {
    it(`keeps multi-stroke undo/redo state and step memory identical on ${size}²`, () => {
      const bounded = createSession(size), legacy = createSession(size);
      const world = bounded.world, spot = findSpot(world), lakeSpot = findSpot(world, false, spot, 24);
      const strokes: Planner[][] = [
        [
          (_world, state) => ({ brushes: [], changes: [raiseStampAt(state, spot.x, spot.z, 11)] }),
          (_world, state) => ({ brushes: [], changes: [raiseStampAt(state, spot.x, spot.z, 11)] }),
          (_world, state) => ({ brushes: [], changes: [raiseStampAt(state, spot.x + 8, spot.z, 12)] })
        ],
        [
          (_world, state) => ({ brushes: [], changes: [raiseStampAt(state, lakeSpot.x, lakeSpot.z, 13, "lake")] }),
          (_world, state) => ({ brushes: [], changes: [raiseStampAt(state, lakeSpot.x, lakeSpot.z, 13, "lake")] })
        ],
        [
          (_world, state) => ({ brushes: [], changes: removeStampsNear(state, spot.x, spot.z, 24) })
        ]
      ];
      for (const [index, planners] of strokes.entries()) {
        stroke(bounded, planners, true);
        stroke(legacy, planners, false);
        expectSameState(bounded.world, bounded.state, legacy.world, legacy.state, `${size}² stroke ${index}`);
        expect(bounded.history.stats()).toEqual(legacy.history.stats());
      }
      const steps = bounded.history.stats().steps;
      for (let step = 0; step < steps; step += 1) {
        bounded.history.undo();
        legacy.history.undo();
        expectSameState(bounded.world, bounded.state, legacy.world, legacy.state, `${size}² undo ${step}`);
      }
      for (let step = 0; step < steps; step += 1) {
        bounded.history.redo();
        legacy.history.redo();
        expectSameState(bounded.world, bounded.state, legacy.world, legacy.state, `${size}² redo ${step}`);
      }
    });
  }
});
