import { displayFogAt } from "../../shared/world/fog-display";
import {
  FOG,
  MATERIAL,
  MATERIAL_COUNT,
  NO_MINE_ZONE,
  ORE,
  PROP,
  type WorldData
} from "../../shared/world/world-data";

export type Rgb = readonly [number, number, number];

/** Map colour per ground material (MATERIAL order); mine fields their own pale grey. */
const GROUND_COLORS: readonly Rgb[] = [
  [104, 146, 64],
  [84, 140, 52],
  [62, 98, 46],
  [134, 104, 72],
  [214, 196, 146],
  [118, 118, 122],
  [236, 241, 246],
  [146, 136, 120],
  [201, 195, 182]
];
/** Water by depth (the minimap and the editor's lake icon). */
export const WATER_COLORS = { deep: [26, 74, 112] as Rgb, shallow: [58, 128, 156] as Rgb };
const FOREST: Rgb = [38, 70, 36];
const MINE_EDGE: Rgb = [92, 88, 82];
const HIDDEN: Rgb = [16, 22, 28];
/** Ore marker colours of surveyed fields (ORE order; none: no marker). */
export const ORE_COLORS: Partial<Record<number, Rgb>> = {
  [ORE.coal]: [24, 24, 26],
  [ORE.iron]: [176, 98, 54],
  [ORE.gold]: [236, 196, 70],
  [ORE.granite]: [244, 242, 236]
};
const TREES = new Set<number>([
  PROP.cedarTree,
  PROP.walnutTree,
  PROP.mahoganyTree,
  PROP.hardwoodTree,
  PROP.broadleafTree,
  PROP.coniferTree,
  PROP.palmTree,
  PROP.birchTree
]);
/** Light from the north west over the vertex normals: hills and mountains read in relief. */
const LIGHT = { x: -0.55, y: 0.75, z: -0.37 } as const;

export interface MinimapImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  height: number;
  width: number;
}

const mixColor = (from: Rgb, to: Rgb, amount: number): Rgb => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount
];

/** Ground colour of a vertex: its splat weights over the material colours. */
const getGroundColor = (world: WorldData, vertex: number): Rgb => {
  let [red, green, blue] = [0, 0, 0];
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    const weight = world.splat[vertex * MATERIAL_COUNT + material]! / 255;
    const ground = GROUND_COLORS[material]!;
    red += ground[0] * weight;
    green += ground[1] * weight;
    blue += ground[2] * weight;
  }
  return [red, green, blue];
};

const getRelief = (world: WorldData, vertex: number) => {
  const [x, y, z] = [
    world.normals[vertex * 3]!,
    world.normals[vertex * 3 + 1]!,
    world.normals[vertex * 3 + 2]!
  ];
  return 0.62 + 0.5 * Math.max(0, x * LIGHT.x + y * LIGHT.y + z * LIGHT.z);
};

/** Cells with a tree trunk (forests read as dark green). */
const collectTreeCells = (world: WorldData) => {
  const cells = new Uint8Array(world.cellsX * world.cellsZ);
  const { props } = world;
  for (let index = 0; index < props.count; index += 1) {
    if (!TREES.has(props.types[index]!)) continue;
    cells[Math.floor(props.z[index]!) * world.cellsX + Math.floor(props.x[index]!)] = 1;
  }
  return cells;
};

/** Outer edge of the mine land (deposits inside it stay hidden until surveyed). */
const isMineEdge = (world: WorldData, cellX: number, cellZ: number) => {
  if (world.mineZone[cellZ * world.cellsX + cellX] === NO_MINE_ZONE) return false;
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ].some(([dx, dz]) => {
    const x = cellX + dx!;
    const z = cellZ + dz!;
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return true;
    return world.mineZone[z * world.cellsX + x] === NO_MINE_ZONE;
  });
};

const getBaseColor = (world: WorldData, trees: Uint8Array, cell: number, vertex: number): Rgb => {
  if (world.mineZone[cell] !== NO_MINE_ZONE) return GROUND_COLORS[MATERIAL.mine]!;
  return trees[cell] === 1 ? FOREST : getGroundColor(world, vertex);
};

const getCellColor = (world: WorldData, trees: Uint8Array, cellX: number, cellZ: number): Rgb => {
  const cell = cellZ * world.cellsX + cellX;
  if (displayFogAt(world, cell) === FOG.hidden) return HIDDEN;
  const vertex = cellZ * (world.cellsX + 1) + cellX;
  const depth = world.waterDepth[vertex]!;
  if (depth > 0.05)
    return mixColor(WATER_COLORS.shallow, WATER_COLORS.deep, Math.min(1, depth / 3));
  if (isMineEdge(world, cellX, cellZ)) return MINE_EDGE;
  const ground = getBaseColor(world, trees, cell, vertex);
  const relief = getRelief(world, vertex);
  return [ground[0] * relief, ground[1] * relief, ground[2] * relief];
};

/** A small square marker in the ore's colour at the centre of every surveyed field. */
const markSurveyedFields = (world: WorldData, image: MinimapImage) => {
  for (const zone of world.mineZones) {
    const color = ORE_COLORS[zone.ore];
    const centreX = Math.floor(zone.centreX),
      centreZ = Math.floor(zone.centreZ);
    const centreCell = centreZ * world.cellsX + centreX;
    if (!zone.surveyed || !color || zone.cellCount === 0 || displayFogAt(world, centreCell) === FOG.hidden)
      continue;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = Math.floor(zone.centreX) + dx;
        const z = Math.floor(zone.centreZ) + dz;
        if (x < 0 || z < 0 || x >= image.width || z >= image.height) continue;
        const cell = z * world.cellsX + x;
        if (displayFogAt(world, cell) === FOG.hidden || world.mineZone[cell] !== zone.id) continue;
        image.data.set([...color, 255], (z * image.width + x) * 4);
      }
    }
  }
};

/**
 * Top-down minimap pixels, one per cell (row = z): water by depth, ground from the splat with
 * hill shading, forests, the mine fields in their own grey with a dark edge, an ore marker on
 * surveyed fields, hidden fog of war near black. The widget draws it into the iso diamond.
 */
export const createMinimapImage = (world: WorldData): MinimapImage => {
  const image = {
    data: new Uint8ClampedArray(world.cellsX * world.cellsZ * 4),
    height: world.cellsZ,
    width: world.cellsX
  };
  const trees = collectTreeCells(world);
  for (let cellZ = 0; cellZ < world.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < world.cellsX; cellX += 1) {
      const color = getCellColor(world, trees, cellX, cellZ);
      image.data.set([...color, 255], (cellZ * world.cellsX + cellX) * 4);
    }
  }
  markSurveyedFields(world, image);
  return image;
};

/** The colour the minimap gives mine ground (tests, legend). */
export const MINE_GROUND_COLOR = GROUND_COLORS[MATERIAL.mine]!;
