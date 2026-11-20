import { describe, expect, it } from "vitest";

import {
  getTreeSpecies,
  getTreeVariant,
  getVariantStage
} from "../src/render-common/props/island-trees";
import { buildPropInstanceRange } from "../src/render-common/props/prop-instances";
import { getBrushWeight } from "../src/shared/world/editing/brush";
import { createEditGround, refreshBuildLayers } from "../src/shared/world/editing/build-refresh";
import { paintGround } from "../src/shared/world/editing/ground-paint";
import { stampOreDeposit } from "../src/shared/world/editing/mine-land";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import {
  CLEARED_BY_PAINT,
  clearPaintedProps,
  PLANT_PROPS,
  removePropsInBrush,
  TREE_PROPS
} from "../src/shared/world/editing/prop-removal";
import { isBlockingProp } from "../src/shared/world/generation/gameplay";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getDominantMaterial } from "../src/shared/world/ground-buffer";
import {
  BLOCKING,
  BUILD,
  MATERIAL,
  MATERIAL_COUNT,
  NO_MINE_ZONE,
  ORE,
  PROP,
  PROP_REMOVED,
  type WorldData
} from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

/** Tree kinds the editor places (a sapling is the young tree of any kind). */
const PLACEABLE_TREES = [
  PROP.broadleafTree,
  PROP.coniferTree,
  PROP.birchTree,
  PROP.palmTree,
  PROP.cedarTree,
  PROP.walnutTree,
  PROP.mahoganyTree,
  PROP.hardwoodTree,
  PROP.sapling
] as const;

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };
const BRUSH = { radius: 3, softness: 0.5 };

/** Whether no cell within `reach` cells of the cell is mine land. */
const isAwayFromMineLand = (world: WorldData, x: number, z: number, reach: number) => {
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (world.mineZone[(z + dz) * world.cellsX + x + dx] !== NO_MINE_ZONE) return false;
    }
  }
  return true;
};

/** Centre of a large building spot away from mine land (open flat ground). */
const findOpenSpot = (world: WorldData) => {
  for (let cell = 0; cell < world.buildClass.length; cell += 1) {
    const x = cell % world.cellsX;
    const z = Math.floor(cell / world.cellsX);
    if (x < 8 || z < 8 || x > world.cellsX - 8 || z > world.cellsZ - 8) continue;
    const vertex = z * (world.cellsX + 1) + x;
    const isInland = world.coastDistance[vertex]! >= 14 && world.riverDistance[vertex]! >= 14;
    if (world.buildClass[cell] !== BUILD.large || !isInland) continue;
    if (isAwayFromMineLand(world, x, z, 5)) return { x: x + 0.5, z: z + 0.5 };
  }
  throw new Error("no open spot");
};

/** Places a prop on the first free spot of a small square around the point. */
const placeNear = (world: WorldData, kind: number, point: { x: number; z: number }) => {
  for (let step = 0; step < 25; step += 1) {
    const x = point.x + (step % 5) - 2;
    const z = point.z + Math.floor(step / 5) - 2;
    const index = placeProp(world, { kind, seed: step, x, z });
    if (typeof index === "number") return index;
  }
  throw new Error("no free spot");
};

const sumSplat = (world: WorldData, vertex: number) =>
  world.splat
    .subarray(vertex * MATERIAL_COUNT, (vertex + 1) * MATERIAL_COUNT)
    .reduce((sum, weight) => sum + weight, 0);

const cellAt = (world: WorldData, x: number, z: number) =>
  Math.floor(z) * world.cellsX + Math.floor(x);

describe("map editor brush", () => {
  it("covers fully in the hard core and fades to nothing at the rim", () => {
    const brush = { ...BRUSH, x: 0, z: 0 };
    expect(getBrushWeight(brush, 1)).toBe(1);
    expect(getBrushWeight(brush, 2.2)).toBeGreaterThan(0);
    expect(getBrushWeight(brush, 2.2)).toBeLessThan(1);
    expect(getBrushWeight(brush, 3)).toBe(0);
  });
});

describe("map editor ground paint", () => {
  const world = cachedWorld(SMALL);
  const spot = findOpenSpot(world);

  it("paints the material under the brush with normalised weights", () => {
    const brush = { ...BRUSH, ...spot, material: MATERIAL.sand, strength: 0.7 };
    const painted = paintGround(world, brush);
    paintGround(world, brush);
    const vertex = Math.floor(spot.z) * (world.cellsX + 1) + Math.floor(spot.x);
    expect(getDominantMaterial(world.splat, vertex)).toBe(MATERIAL.sand);
    for (let dz = -3; dz <= 3; dz += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        expect(Math.abs(sumSplat(world, vertex + dz * (world.cellsX + 1) + dx) - 255)).toBeLessThan(
          MATERIAL_COUNT
        );
      }
    }
    expect(painted.cells.minX).toBeLessThanOrEqual(Math.floor(spot.x) - 2);
    expect(painted.cells.maxX).toBeGreaterThanOrEqual(Math.floor(spot.x) + 2);
    expect(painted.zoneIds.size).toBe(0);
  });

  it("creates mine land with mine gravel and removes it with other ground", () => {
    const ground = createEditGround(world);
    const zones = world.mineZones.length;
    const mine = paintGround(world, { ...BRUSH, ...spot, material: MATERIAL.mine, strength: 1 });
    refreshBuildLayers(world, ground, mine.cells);
    const cell = cellAt(world, spot.x, spot.z);
    const zoneId = world.mineZone[cell]!;
    expect(zoneId).not.toBe(NO_MINE_ZONE);
    expect(world.mineZones).toHaveLength(zones + 1);
    expect(world.mineZones[zoneId - 1]!.ore).toBe(ORE.none);
    expect(world.mineZones[zoneId - 1]!.cellCount).toBeGreaterThan(10);
    expect(world.buildCap[cell]).toBe(BUILD.mine);
    expect(world.buildClass[cell]).toBe(BUILD.mine);

    const grass = paintGround(world, { ...BRUSH, ...spot, material: MATERIAL.grass, strength: 1 });
    refreshBuildLayers(world, ground, grass.cells);
    expect(world.mineZone[cell]).toBe(NO_MINE_ZONE);
    expect(world.mineZones[zoneId - 1]!.cellCount).toBe(0);
    expect(world.buildCap[cell]).toBe(BUILD.large);
  });
});

describe("map editor ore deposits", () => {
  const world = cachedWorld(SMALL);
  const spot = findOpenSpot(world);

  it("refuses ore outside mine land", () => {
    expect(stampOreDeposit(world, { ...BRUSH, ...spot }, ORE.gold)).toBe("notMineLand");
  });

  it("refuses an unusable edge deposit atomically, then accepts an interior plot", () => {
    const candidate = cachedWorld(SMALL);
    // Isolate placement from procedural coastline: a three-cell dry shore patch cannot fit a 5×4 mine.
    candidate.heights.fill(1); candidate.waterDepth.fill(0);
    candidate.blocking.fill(BLOCKING.water); candidate.walkCost.fill(0);
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
      candidate.blocking[z * candidate.cellsX + x] = 0;
      candidate.walkCost[z * candidate.cellsX + x] = 10;
    }
    candidate.buildClass.fill(BUILD.large); candidate.buildCap.fill(BUILD.large);
    candidate.slopeClass.fill(0); candidate.props.count = 0;
    candidate.mineZone.fill(NO_MINE_ZONE); candidate.oreAmount.fill(0); candidate.mineZones = [];
    candidate.mineZone[0] = 1;
    candidate.mineZones.push({ id: 1, ore: ORE.none, richness: 0,
      surveyed: false, cellCount: 1, centreX: .5, centreZ: .5 });
    const zones = JSON.stringify(candidate.mineZones);
    const ids = candidate.mineZone.slice(), amounts = candidate.oreAmount.slice();
    expect(stampOreDeposit(candidate, { radius: 1, softness: 0, x: .5, z: .5 }, ORE.iron))
      .toBe("noMinePlot");
    expect(candidate.mineZone).toEqual(ids);
    expect(candidate.oreAmount).toEqual(amounts);
    expect(JSON.stringify(candidate.mineZones)).toBe(zones);
    candidate.blocking.fill(0); candidate.walkCost.fill(10);
    const cell = 20 * candidate.cellsX + 20;
    candidate.mineZone[cell] = 1;
    const result = stampOreDeposit(candidate, { radius: 1, softness: 0, x: 20.5, z: 20.5 }, ORE.iron);
    expect(typeof result).toBe("object");
    expect(candidate.oreAmount[cell]).toBeGreaterThan(0);
  });

  it("stamps a deposit hidden until surveyed, more ore in the core than at the rim", () => {
    paintGround(world, { ...BRUSH, ...spot, radius: 5, material: MATERIAL.mine, strength: 1 });
    const stamp = stampOreDeposit(world, { ...BRUSH, ...spot }, ORE.iron);
    if (typeof stamp === "string") throw new Error(stamp);
    const centre = cellAt(world, spot.x, spot.z);
    const zone = world.mineZones[world.mineZone[centre]! - 1]!;
    expect(zone.ore).toBe(ORE.iron);
    expect(zone.surveyed).toBe(false);
    const rim = cellAt(world, spot.x + 2, spot.z);
    expect(world.mineZone[rim]).toBe(zone.id);
    expect(world.oreAmount[centre]).toBeGreaterThan(world.oreAmount[rim]!);
    const outside = cellAt(world, spot.x + 4, spot.z);
    expect(world.oreAmount[outside]).toBe(0);
    const again = stampOreDeposit(world, { ...BRUSH, ...spot, x: spot.x + 1 }, ORE.iron);
    if (typeof again === "string") throw new Error(again);
    expect(world.mineZone[cellAt(world, spot.x + 3, spot.z)]).toBe(zone.id);
  });
});

describe("map editor trees", () => {
  const world = cachedWorld(SMALL);
  const spot = findOpenSpot(world);
  const first = world.props.count;

  it("blocks the trunk cell and shrinks the building room around a placed tree", () => {
    const index = placeProp(world, { kind: PROP.coniferTree, seed: 7, ...spot });
    expect(index).toBe(first);
    expect(world.props.count).toBe(first + 1);
    expect(world.props.types[first]).toBe(PROP.coniferTree);
    const cell = cellAt(world, spot.x, spot.z);
    expect(world.blocking[cell]).toBe(BLOCKING.prop);
    expect(world.buildClass[cell]).toBe(BUILD.none);
    expect(world.buildClass[cell + 2]).toBeLessThanOrEqual(BUILD.flag);
    expect(placeProp(world, { kind: PROP.palmTree, seed: 8, ...spot })).toBe("blocked");
  });

  it("places every tree kind in its final, mature form (drawn at once, never a sprout)", () => {
    for (const [offset, kind] of PLACEABLE_TREES.entries()) {
      if (kind === PROP.sapling) continue;
      // A compact 3-column grid keeps every tree on the small island's open ground.
      const point = { x: spot.x + 8 + (offset % 3) * 3, z: spot.z + 8 + Math.floor(offset / 3) * 3 };
      const index = placeNear(world, kind, point);
      const { form, scale } = world.props;
      expect(getVariantStage(kind, getTreeVariant(kind, scale[index]!, form[index]!))).toBe(5);
      const instances = buildPropInstanceRange(
        world,
        new Float32Array(9409).fill(1),
        index,
        index + 1
      );
      expect(instances.count).toBe(1);
      expect(instances.scale[0]).toBeGreaterThan(0.8);
    }
  });

  it("removes trees under the brush and frees their land", () => {
    const { removed } = removePropsInBrush(world, { ...BRUSH, radius: 0.5, ...spot }, (index) =>
      TREE_PROPS.has(world.props.types[index]!)
    );
    expect(removed).toEqual([first]);
    expect(world.props.types[first]).toBe(PROP_REMOVED);
    const cell = cellAt(world, spot.x, spot.z);
    expect(world.blocking[cell]).toBe(BLOCKING.free);
    expect(world.buildClass[cell]).toBe(BUILD.large);
  });
});

describe("map editor clearing painted ground", () => {
  const world = cachedWorld(SMALL);

  it("removes the small props on the painted cells and keeps the trees", () => {
    const { props } = world;
    const bush = [...Array(props.count).keys()].find((index) =>
      CLEARED_BY_PAINT.has(props.types[index]!)
    )!;
    const brush = { ...BRUSH, x: props.x[bush]!, z: props.z[bush]! };
    const trees = [...Array(props.count).keys()].filter(
      (index) =>
        getTreeSpecies(props.types[index]!) !== undefined &&
        Math.hypot(props.x[index]! - brush.x, props.z[index]! - brush.z) < 2
    );
    const { removed } = clearPaintedProps(world, brush);
    expect(removed).toContain(bush);
    expect(props.types[bush]).toBe(PROP_REMOVED);
    for (const tree of trees) expect(props.types[tree]).not.toBe(PROP_REMOVED);
    const cell = Math.floor(props.z[bush]!) * world.cellsX + Math.floor(props.x[bush]!);
    const stillBlocked = [...Array(props.count).keys()].some(
      (index) =>
        isBlockingProp(props.types[index]!) &&
        Math.floor(props.z[index]!) * world.cellsX + Math.floor(props.x[index]!) === cell
    );
    expect(world.blocking[cell] === BLOCKING.prop).toBe(stillBlocked);
  });
});

describe("map editor doodads", () => {
  const world = cachedWorld(SMALL);
  const spot = findOpenSpot(world);

  it("places blocking meadow stones and pebble patches that block nothing", () => {
    const stone = placeProp(world, { kind: PROP.largeRock, seed: 1, ...spot });
    expect(stone).toBeTypeOf("number");
    expect(world.blocking[cellAt(world, spot.x, spot.z)]).toBe(BLOCKING.prop);
    const pebbles = findOpenSpot(world);
    expect(placeProp(world, { kind: PROP.pebbles, seed: 2, ...pebbles })).toBeTypeOf("number");
    expect(world.blocking[cellAt(world, pebbles.x, pebbles.z)]).toBe(BLOCKING.free);
  });

  it("removes plants under the brush but keeps stones and trees", () => {
    const { props } = world;
    const plant = [...Array(props.count).keys()].find((index) =>
      PLANT_PROPS.has(props.types[index]!)
    )!;
    const brush = { ...BRUSH, x: props.x[plant]!, z: props.z[plant]! };
    const kept = [...Array(props.count).keys()].filter(
      (index) =>
        !PLANT_PROPS.has(props.types[index]!) &&
        props.types[index] !== PROP_REMOVED &&
        Math.hypot(props.x[index]! - brush.x, props.z[index]! - brush.z) <= brush.radius
    );
    const { removed } = removePropsInBrush(world, brush, (index) =>
      PLANT_PROPS.has(props.types[index]!)
    );
    expect(removed).toContain(plant);
    for (const index of kept) expect(props.types[index]).not.toBe(PROP_REMOVED);
  });
});
