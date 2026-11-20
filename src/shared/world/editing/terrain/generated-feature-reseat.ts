import { getTreeSpecies } from "../../../../render-common/props/island-trees";
import { navigationPropRadius } from "../../../settlement/navigation-prop-geometry";
import { isStandingBlocker } from "../../build-class";
import { getCellTerrain } from "../../generation/gameplay";
import { type CellRegion, getCircleRegion, sampleSmooth, unionRegions } from "../../grid-geometry";
import { BLOCKING, PROP_REMOVED, type WorldData } from "../../world-data";
import { aquaticDecorationSpot } from "../aquatic-decoration";
import type { FeaturePropMove } from "./generated-feature-props";
import type { FeatureTransformRuntime } from "./generated-feature-runtime";

/** Vertices (offsets around the anchor cell) whose height the smoothed ground under a prop samples. */
const HALO = [-1, 2] as const;
/** Farthest re-seat distance (tiles) from the original spot. */
const SEARCH_RADIUS = 16;
/** Spacing kept to a non-blocking neighbour (decorations, plants). */
const DECORATION_SPACING = 0.6;

interface ReseatContext {
  blocked: ReadonlySet<number>;
  candidate: WorldData;
  occupied: Map<number, number[]>;
  world: WorldData;
}

const haloTouches = (world: WorldData, blocked: ReadonlySet<number>, x: number, z: number) => {
  const stride = world.cellsX + 1,
    cellX = Math.floor(x),
    cellZ = Math.floor(z);
  for (let dz = HALO[0]; dz <= HALO[1]; dz++)
    for (let dx = HALO[0]; dx <= HALO[1]; dx++)
      if (blocked.has((cellZ + dz) * stride + cellX + dx)) return true;
  return false;
};

const bucketOf = (world: WorldData, x: number, z: number) =>
  Math.floor(z) * world.cellsX + Math.floor(x);

const occupy = (context: ReseatContext, id: number) => {
  const { candidate, occupied, world } = context;
  const cell = bucketOf(world, candidate.props.x[id]!, candidate.props.z[id]!);
  occupied.set(cell, [...(occupied.get(cell) ?? []), id]);
};

const spacingOf = (world: WorldData, id: number, other: number) =>
  isStandingBlocker(world, id) && isStandingBlocker(world, other)
    ? navigationPropRadius(world, id) + navigationPropRadius(world, other)
    : DECORATION_SPACING;

/** The prop's height at a spot it may stand on (water plants need their habitat), else null. */
const habitatHeight = (context: ReseatContext, id: number, x: number, z: number) => {
  const { candidate, world } = context;
  const aquatic = aquaticDecorationSpot(candidate, world.props.types[id]!, x, z);
  if (aquatic?.refusal) return null;
  if (aquatic) return aquatic.y;
  const terrain = getCellTerrain(candidate, candidate, Math.floor(x), Math.floor(z));
  if (terrain.blocking === BLOCKING.water || terrain.blocking === BLOCKING.cliff) return null;
  return sampleSmooth(candidate, candidate.heights, x, z);
};

const hasSpacing = (context: ReseatContext, id: number, x: number, z: number) => {
  const { candidate, occupied, world } = context;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++)
      for (const other of occupied.get(bucketOf(world, x + dx, z + dz)) ?? []) {
        const distance = Math.hypot(candidate.props.x[other]! - x, candidate.props.z[other]! - z);
        if (other !== id && distance < spacingOf(world, id, other)) return false;
      }
  return true;
};

/** The prop's height at a free spot (inside the map, clear of protection and neighbours). */
const freeSpotHeight = (context: ReseatContext, id: number, x: number, z: number) => {
  const { blocked, world } = context;
  if (x < 1 || z < 1 || x > world.cellsX - 1 || z > world.cellsZ - 1) return null;
  if (haloTouches(world, blocked, x, z) || !hasSpacing(context, id, x, z)) return null;
  return habitatHeight(context, id, x, z);
};

/** Ring offsets ordered by distance (its own spot first), so the first free one is the nearest. */
const SEARCH_OFFSETS = (() => {
  const offsets: [number, number][] = [];
  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++)
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++)
      if (Math.hypot(dx, dz) <= SEARCH_RADIUS) offsets.push([dx, dz]);
  return offsets.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
})();

const assertMovable = (world: WorldData, id: number, runtime?: FeatureTransformRuntime) => {
  const kind = world.props.types[id]!;
  if (getTreeSpecies(kind) !== undefined && !isStandingBlocker(world, id))
    throw new Error("Wait for active tree felling near the destination to finish.");
  const refusal = runtime?.canMoveProp?.(id);
  if (refusal) throw new Error(refusal);
};

/** Searches from the prop's planned spot (its own, or where a carried prop would have landed). */
const findSpot = (context: ReseatContext, id: number): FeaturePropMove => {
  const { candidate } = context;
  const x = candidate.props.x[id]!,
    z = candidate.props.z[id]!;
  for (const [dx, dz] of SEARCH_OFFSETS) {
    const y = freeSpotHeight(context, id, x + dx, z + dz);
    if (y === null) continue;
    return { id, x: Math.fround(x + dx), y, z: Math.fround(z + dz) };
  }
  throw new Error(
    "No free spot nearby to re-seat an unrelated tree, rock or plant. Choose a clearer destination."
  );
};

/** Unrelated props whose smoothed ground the edit changes (they are re-seated). */
export const findDisplacedProps = (
  world: WorldData,
  changedVertices: readonly number[],
  attached: ReadonlySet<number>,
  region: CellRegion
) => {
  const changed = new Set(changedVertices),
    displaced = new Set<number>();
  for (let id = 0; id < world.props.count; id++) {
    if (world.props.types[id] === PROP_REMOVED || attached.has(id)) continue;
    const x = world.props.x[id]!,
      z = world.props.z[id]!;
    if (x < region.minX - 3 || x > region.maxX + 4 || z < region.minZ - 3 || z > region.maxZ + 4)
      continue;
    if (haloTouches(world, changed, x, z)) displaced.add(id);
  }
  return displaced;
};

/**
 * Unrelated trees, rocks and plants whose ground the edit changes are re-seated at the nearest
 * free dry spot, their own spot first (then they only follow the new ground): same prop ID, so
 * type, age and quantity are kept. Water plants need their habitat; active felling and reserved props still refuse.
 */
export const reseatUnrelatedProps = (
  world: WorldData,
  candidate: WorldData,
  displaced: ReadonlySet<number>,
  protectedVertices: ReadonlySet<number>,
  runtime?: FeatureTransformRuntime
) => {
  const context: ReseatContext = {
    blocked: protectedVertices,
    candidate,
    occupied: new Map(),
    world
  };
  for (let id = 0; id < world.props.count; id++)
    if (world.props.types[id] !== PROP_REMOVED && !displaced.has(id)) occupy(context, id);
  return [...displaced].map((id) => {
    assertMovable(world, id, runtime);
    const move = findSpot(context, id);
    candidate.props.x[id] = move.x;
    candidate.props.y[id] = move.y;
    candidate.props.z[id] = move.z;
    occupy(context, id);
    return move;
  });
};

/** Bounds grown by the props' new spots (their terrain and instances refresh there too). */
export const reseatRegion = (
  world: WorldData,
  region: CellRegion,
  moves: readonly FeaturePropMove[]
) =>
  moves.reduce(
    (area, move) => unionRegions(area, getCircleRegion(world, move.x, move.z, 3)),
    region
  );
