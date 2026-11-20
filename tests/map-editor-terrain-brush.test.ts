import { describe, expect, it } from "vitest";

import { applyEditorTool } from "../src/app/map-editor/editor-apply";
import { fishingSites } from "../src/shared/settlement/settlement-fishing";
import { makeBuilding, placementReason } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { createEditGround } from "../src/shared/world/editing/build-refresh";
import { applyStampChanges } from "../src/shared/world/editing/terrain/terrain-apply";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const worldFor = () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 100, rivers: 0 });
  world.props.types.fill(PROP_REMOVED);
  world.riverDistance.fill(100);
  world.lakeWater = new Uint8Array(world.heights.length);
  for (let z = 0; z <= 96; z++) for (let x = 0; x <= 96; x++) {
    const i = z * 97 + x;
    world.heights[i] = x < 48 ? 7 : -3;
    world.waterSurface[i] = 0;
    world.waterDepth[i] = x < 48 ? 0 : 3;
    world.lakeWater![i] = 0;
  }
  return world;
};
const contextFor = (world: WorldData) => ({
  options: { world, roads: { route: () => null, addRoad: () => true, upgradeRoad: () => true } },
  buildings: [], actors: [], occupied: new Uint8Array(96 ** 2), reservations: new Set(), nextBuilding: 0,
  nextActor: 0, settlers: 1, resourceAmounts: new Map(), accumulator: 0, scheduling: 0, transfers: []
} as SettlementContext);

describe("gentle terrain brushes", () => {
  it("raises/lowers slightly, smooths spikes and adds only small coherent unevenness", () => {
    const world = worldFor(), state = createTerrainEditState(), i = 48 * 97 + 24;
    const brush = { x: 24, z: 48, radius: 6 };
    applyStampChanges(world, state, [], null, [{ ...brush, mode: "raise" }]);
    expect(world.heights[i]).toBeCloseTo(7.2);
    applyStampChanges(world, state, [], null, [{ ...brush, mode: "lower" }]);
    expect(world.heights[i]).toBeCloseTo(7);
    world.heights[i] = 9;
    applyStampChanges(world, state, [], null, [{ ...brush, mode: "smooth" }]);
    expect(world.heights[i]).toBeLessThan(8);
    const before = world.heights[i]!;
    applyStampChanges(world, state, [], null, [{ ...brush, mode: "roughen" }]);
    expect(Math.abs(world.heights[i]! - before)).toBeLessThanOrEqual(.121);
  });

  it("turns a high cliff into a real fishing bank and valid ocean harbour foundations", () => {
    const world = worldFor(), state = createTerrainEditState();
    applyStampChanges(world, state, [], null, [{ x: 48, z: 48, radius: 16, mode: "beach" }]);
    const context = contextFor(world);
    const fish = [];
    for (let z = 45; z <= 51; z++) for (let x = 46; x <= 51; x++)
      fish.push(...fishingSites(context, { id: 1, kind: "fish", x, z }));
    expect(fish.length).toBeGreaterThan(0);
    const plots = [];
    for (let x = 36; x <= 45; x++) for (let rotation = 0; rotation < 4; rotation++) {
      const draft = makeBuilding(context, 39, x, 48, rotation);
      if (!placementReason(context, draft)) plots.push(draft);
    }
    expect(plots.length).toBeGreaterThan(0);
    expect(world.waterDepth[48 * 97 + 55]).toBeGreaterThan(.25);
    expect(world.lakeWater![48 * 97 + 55]).toBe(0);
  }, 30000);

  it("Sea creates sea-level ocean water, independently of the Lake stamp tool", () => {
    const world = worldFor(), state = createTerrainEditState();
    applyStampChanges(world, state, [], null, [{ x: 40, z: 48, radius: 12, mode: "sea" }]);
    const i = 48 * 97 + 40;
    expect(world.heights[i]).toBe(-3);
    expect(world.waterSurface[i]).toBe(world.seaLevel);
    expect(world.waterDepth[i]).toBe(3);
    expect(world.lakeWater![i]).toBe(0);
  });

  it("the doodad eraser removes original shoreline palms as well as stones", () => {
    const world = worldFor();
    world.props.types[0] = PROP.palmTree;
    world.props.types[1] = PROP.largeRock;
    world.props.x[0] = 30; world.props.z[0] = 48;
    world.props.x[1] = 31; world.props.z[1] = 48;
    const outcome = applyEditorTool({ world, ground: createEditGround(world), firstPlacedProp: world.props.count,
      placeAnimal: () => false, nextSeed: () => 1 }, { kind: "plantRemover", value: 0 }, { x: 30, z: 48 }, 3);
    expect(outcome.removed).toContain(0);
    expect(outcome.removed).toContain(1);
    expect(world.props.types[0]).toBe(PROP_REMOVED);
    expect(world.props.types[1]).toBe(PROP_REMOVED);
  });
});

describe("manual sculpt controls", () => {
  it("scales small sculpting strokes without overshooting flatten targets", () => {
    const world = worldFor(), state = createTerrainEditState(), i = 48 * 97 + 24;
    const brush = { x: 24, z: 48, radius: 6 };
    applyStampChanges(world, state, [], null, [{ ...brush, mode: "raise", strength: .25 }]);
    expect(world.heights[i]).toBeCloseTo(7.05);
    applyStampChanges(world, state, [], null,
      [{ ...brush, mode: "flatten", strength: .5, targetHeight: 3 }]);
    expect(world.heights[i]).toBeCloseTo(5.025);
    applyStampChanges(world, state, [], null,
      [{ ...brush, mode: "flatten", strength: 2, targetHeight: 3 }]);
    expect(world.heights[i]).toBeCloseTo(3);
    expect(state.base!.heights[i]).toBeCloseTo(3);
  });

  it("protects ocean/shore heights and prevents inland sculpting from crossing sea level", () => {
    const world = worldFor(), state = createTerrainEditState();
    const water = 48 * 97 + 50, land = 48 * 97 + 46;
    const beforeDepth = world.waterDepth[water];
    applyStampChanges(world, state, [], null, [{ x: 47, z: 48, radius: 8,
      mode: "flatten", targetHeight: -4, protectCoast: true }]);
    expect(world.heights[water]).toBe(-3);
    expect(world.waterDepth[water]).toBe(beforeDepth);
    expect(world.heights[land]).toBeGreaterThanOrEqual(world.seaLevel + 1);
    expect(world.waterDepth[land]).toBe(0);
  });
});
