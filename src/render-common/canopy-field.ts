import { DMath } from "../shared/math/deterministic-math";
import { type CellRegion,isRegionEmpty } from "../shared/world/grid-geometry";
import { PROP, type WorldData } from "../shared/world/world-data";

/** Crown shade radius (world units at scale 1) and strength per prop type that casts shade. */
const CANOPY_SHADE: Partial<Record<number, readonly [number, number]>> = {
  [PROP.cedarTree]: [2.2, 0.75],
  [PROP.walnutTree]: [2.2, 0.75],
  [PROP.mahoganyTree]: [2.2, 0.75],
  [PROP.hardwoodTree]: [2.2, 0.75],
  [PROP.broadleafTree]: [2.2, 0.75],
  [PROP.coniferTree]: [1.6, 0.85],
  [PROP.palmTree]: [1.6, 0.5],
  [PROP.birchTree]: [1.5, 0.45],
  [PROP.bush]: [0.8, 0.35],
  [PROP.berryBush]: [0.7, 0.3],
  [PROP.broadleafShrub]: [0.6, 0.3],
  [PROP.fern]: [0.6, 0.25],
  [PROP.riverShrub]: [0.8, 0.3],
  [PROP.willowShrub]: [0.7, 0.25],
  [PROP.sapling]: [0.6, 0.2],
  [PROP.fieldShrub]: [0.6, 0.25]
};

/**
 * Litter the crown drops (GROUND-PALETTE steps 3–4): channel 0 pine needles under conifers, 1 leaf litter under
 * temperate broadleaf trees (the tropical mahogany and the palms leave none: the jungle floor is a tint). Reach
 * as a share of the crown shade radius (the needles spread past the crown edge) and strength.
 */
export const LITTER_CHANNELS = 2;
const LITTER: Partial<Record<number, readonly [number, number, number]>> = {
  [PROP.coniferTree]: [0, 1.25, 1],
  [PROP.cedarTree]: [0, 1.15, 0.9],
  [PROP.broadleafTree]: [1, 1.05, 0.9],
  [PROP.walnutTree]: [1, 1.05, 0.9],
  [PROP.hardwoodTree]: [1, 1.05, 0.9],
  [PROP.birchTree]: [1, 1.1, 0.7]
};

const cache = new WeakMap<WorldData, Float32Array>();
const litterCache = new WeakMap<WorldData, Float32Array>();

/** Adds a prop's crown shade to the field, clipped to the vertex bounds (inclusive). */
const addShade = (field: Float32Array, world: WorldData, index: number, bounds: CellRegion) => {
  const shade = CANOPY_SHADE[world.props.types[index]!];
  if (!shade) return;
  const { props } = world;
  const radius = shade[0] * props.scale[index]!;
  const stride = world.cellsX + 1;
  const minX = Math.max(bounds.minX, Math.floor(props.x[index]! - radius));
  const maxX = Math.min(bounds.maxX, Math.ceil(props.x[index]! + radius));
  const minZ = Math.max(bounds.minZ, Math.floor(props.z[index]! - radius));
  const maxZ = Math.min(bounds.maxZ, Math.ceil(props.z[index]! + radius));
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = DMath.hypot(x - props.x[index]!, z - props.z[index]!) / radius;
      if (distance >= 1) continue;
      const vertex = z * stride + x;
      const falloff = (1 - distance * distance) * shade[1];
      field[vertex] = 1 - (1 - field[vertex]!) * (1 - falloff);
    }
  }
};

/** Adds a tree's litter to its channel of the field (vertex bounds inclusive; same reach logic as the shade). */
const addLitter = (field: Float32Array, world: WorldData, index: number, bounds: CellRegion) => {
  const type = world.props.types[index]!;
  const litter = LITTER[type];
  const shade = CANOPY_SHADE[type];
  if (!litter || !shade) return;
  const { props } = world;
  const radius = shade[0] * litter[1] * props.scale[index]!;
  const stride = world.cellsX + 1;
  const minX = Math.max(bounds.minX, Math.floor(props.x[index]! - radius));
  const maxX = Math.min(bounds.maxX, Math.ceil(props.x[index]! + radius));
  const minZ = Math.max(bounds.minZ, Math.floor(props.z[index]! - radius));
  const maxZ = Math.min(bounds.maxZ, Math.ceil(props.z[index]! + radius));
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = DMath.hypot(x - props.x[index]!, z - props.z[index]!) / radius;
      if (distance >= 1) continue;
      const at = (z * stride + x) * LITTER_CHANNELS + litter[0];
      field[at] = 1 - (1 - field[at]!) * (1 - (1 - distance * distance) * litter[2]);
    }
  }
};

/**
 * Crown litter per world vertex (LITTER_CHANNELS per vertex, 0..1): pine needles and broadleaf litter the
 * ground shader lays as render-only tiles. Cached per world like the canopy and refreshed with it.
 */
export const getLitterField = (world: WorldData) => {
  const cached = litterCache.get(world);
  if (cached) return cached;
  const field = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1) * LITTER_CHANNELS);
  const bounds = { maxX: world.cellsX, maxZ: world.cellsZ, minX: 0, minZ: 0 };
  for (let index = 0; index < world.props.count; index += 1) addLitter(field, world, index, bounds);
  litterCache.set(world, field);
  return field;
};

/**
 * Canopy shade per world vertex (0 open sky .. 1 dense crowns): the ground shader darkens and
 * cools the grass under trees and bushes. Cached per world (all chunk builds share it).
 */
export const getCanopyField = (world: WorldData) => {
  const cached = cache.get(world);
  if (cached) return cached;
  const field = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1));
  const bounds = { maxX: world.cellsX, maxZ: world.cellsZ, minX: 0, minZ: 0 };
  for (let index = 0; index < world.props.count; index += 1) {
    addShade(field, world, index, bounds);
  }
  cache.set(world, field);
  return field;
};

/** Props were added or removed in the cells (map editor): their vertices' shade is redone. */
export const refreshCanopyField = (world: WorldData, cells: CellRegion) => {
  if (isRegionEmpty(cells)) return;
  const bounds = { ...cells, maxX: cells.maxX + 1, maxZ: cells.maxZ + 1 };
  refreshLitterField(world, bounds);
  const field = cache.get(world);
  if (!field) return;
  const stride = world.cellsX + 1;
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    field.fill(0, z * stride + bounds.minX, z * stride + bounds.maxX + 1);
  }
  for (let index = 0; index < world.props.count; index += 1) {
    addShade(field, world, index, bounds);
  }
};

/** The litter of the vertices in `bounds` is redone (props added or removed). */
const refreshLitterField = (world: WorldData, bounds: CellRegion) => {
  const field = litterCache.get(world);
  if (!field) return;
  const stride = world.cellsX + 1;
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    field.fill(0, (z * stride + bounds.minX) * LITTER_CHANNELS, (z * stride + bounds.maxX + 1) * LITTER_CHANNELS);
  }
  for (let index = 0; index < world.props.count; index += 1) addLitter(field, world, index, bounds);
};
