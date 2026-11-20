import { getTreeSpecies } from "../../../../render-common/props/island-trees";
import { navigationPropRadius } from "../../../settlement/navigation-prop-geometry";
import { getPlacedTreeClearanceBox } from "../../../settlement/settlement-rotor-clearance";
import { isStandingBlocker } from "../../build-class";
import { getCellTerrain, isBlockingProp } from "../../generation/gameplay";
import { getWaterlineFoot, LILY_FLOAT } from "../../generation/water-plants";
import {
  EMPTY_REGION,
  getCircleRegion,
  sampleBilinear,
  sampleSmooth,
  unionRegions
} from "../../grid-geometry";
import { BLOCKING, PROP, PROP_REMOVED, type WorldData } from "../../world-data";
import { aquaticDecorationSpot, isAquaticDecoration } from "../aquatic-decoration";
import { nativeFeatureStoneRadius } from "./generated-feature-prop-bounds";
import type { TerrainComponent } from "./terrain-component";

export interface FeaturePropMove {
  id: number;
  x: number;
  y: number;
  z: number;
}
interface Transform {
  cx: number;
  cz: number;
  offsetX: number;
  offsetZ: number;
  scale: number;
}

/**
 * Anchors define attachment: props anchored inside the contour or within their guard halo of
 * its moved ground; canopy overlap alone never drags an unrelated neighbouring tree.
 */
export const attachedFeatureProps = (
  world: WorldData,
  selection: TerrainComponent,
  sourceVertices: ReadonlySet<number>
) => {
  const cells = new Set(selection.cells),
    ids = new Set<number>();
  for (let id = 0; id < world.props.count; id++) {
    if (world.props.types[id] === PROP_REMOVED) continue;
    const cell = Math.floor(world.props.z[id]!) * world.cellsX + Math.floor(world.props.x[id]!);
    const x = Math.floor(world.props.x[id]!),
      z = Math.floor(world.props.z[id]!),
      stride = world.cellsX + 1;
    let sampled = false;
    // The props' guard halo (-2..3 vertices): a prop that close to moved ground moves with it.
    for (let dz = -2; dz <= 3; dz++)
      for (let dx = -2; dx <= 3; dx++)
        if (sourceVertices.has((z + dz) * stride + x + dx)) sampled = true;
    if (!cells.has(cell) && !sampled) continue;
    if (getTreeSpecies(world.props.types[id]!) !== undefined && !isStandingBlocker(world, id))
      throw new Error("Wait for active tree felling to finish before moving this contour.");
    ids.add(id);
  }
  if (ids.size > 8192)
    throw new Error(
      "Selected contour has more than 8,192 attached props. Select a smaller complete contour."
    );
  return ids;
};

/** Full native mature-tree envelope protects plots/roads; physical root radii govern forest spacing. */
const clearanceRadius = (world: WorldData, id: number) => {
  const kind = world.props.types[id]!;
  if (kind === PROP.smallRock || kind === PROP.largeRock || kind === PROP.pebbles)
    return nativeFeatureStoneRadius(world, id);
  if (getTreeSpecies(kind) === undefined) return navigationPropRadius(world, id);
  const box = getPlacedTreeClearanceBox(world, id);
  const x = world.props.x[id]!,
    z = world.props.z[id]!;
  return Math.max(
    Math.abs(box.min[0] - x),
    Math.abs(box.max[0] - x),
    Math.abs(box.min[2] - z),
    Math.abs(box.max[2] - z)
  );
};

/** Include complete native envelopes at both ends when protecting/rebuilding the transaction. */
export const featurePropTransformRegion = (
  world: WorldData,
  ids: ReadonlySet<number>,
  transform: Transform
) => {
  let region = EMPTY_REGION;
  for (const id of ids) {
    const radius = clearanceRadius(world, id) + 2,
      x = world.props.x[id]!,
      z = world.props.z[id]!;
    const nextX = transform.cx + (x - transform.cx) * transform.scale + transform.offsetX;
    const nextZ = transform.cz + (z - transform.cz) * transform.scale + transform.offsetZ;
    region = unionRegions(region, getCircleRegion(world, x, z, radius));
    region = unionRegions(region, getCircleRegion(world, nextX, nextZ, radius));
  }
  return region;
};

/** Only a valid source habitat can be lost (a prop the rules would not place now keeps riding along). */
const losesAquaticHabitat = (
  world: WorldData,
  candidate: WorldData,
  kind: number,
  from: { x: number; z: number },
  to: { x: number; z: number }
) =>
  !!aquaticDecorationSpot(candidate, kind, to.x, to.z)?.refusal &&
  !aquaticDecorationSpot(world, kind, from.x, from.z)?.refusal;

/** A native stone cluster loses its companions on steep ground or in water around it. */
const isStoneClusterExposed = (candidate: WorldData, x: number, z: number, radius: number) =>
  [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius]
  ].some(([dx, dz]) => {
    const px = x + dx!,
      pz = z + dz!,
      h = (ox: number, oz: number) => sampleSmooth(candidate, candidate.heights, px + ox, pz + oz);
    const gradient = Math.hypot((h(0.25, 0) - h(-0.25, 0)) / 0.5, (h(0, 0.25) - h(0, -0.25)) / 0.5);
    return (
      gradient > 0.8 || sampleBilinear(candidate, candidate.waterSurface, px, pz) > h(0, 0) + 0.01
    );
  });

/** Whether the prop's transformed spot (already in the candidate) is no valid place for it. */
const losesLanding = (
  world: WorldData,
  candidate: WorldData,
  id: number,
  from: { x: number; z: number },
  radius: number
) => {
  const kind = world.props.types[id]!,
    x = candidate.props.x[id]!,
    z = candidate.props.z[id]!;
  if (isAquaticDecoration(kind)) return losesAquaticHabitat(world, candidate, kind, from, { x, z });
  const terrain = getCellTerrain(candidate, candidate, Math.floor(x), Math.floor(z));
  if (terrain.blocking === BLOCKING.water || terrain.blocking === BLOCKING.cliff) return true;
  const stone = kind === PROP.smallRock || kind === PROP.largeRock || kind === PROP.pebbles;
  return stone && isStoneClusterExposed(candidate, x, z, radius);
};

export const planFeaturePropMoves = (
  world: WorldData,
  candidate: WorldData,
  ids: ReadonlySet<number>,
  transform: Transform,
  protectedVertices: ReadonlySet<number>,
  displaced: ReadonlySet<number> = new Set(),
  stranded = new Set<number>()
): FeaturePropMove[] => {
  const moves: FeaturePropMove[] = [],
    stride = world.cellsX + 1;
  for (const id of ids) {
    const kind = world.props.types[id]!,
      scale = world.props.scale[id]!;
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(world.props.rotation[id]!))
      throw new Error(`Attached prop ${id} has an invalid native appearance.`);
    const x = Math.fround(
      transform.cx + (world.props.x[id]! - transform.cx) * transform.scale + transform.offsetX
    );
    const z = Math.fround(
      transform.cz + (world.props.z[id]! - transform.cz) * transform.scale + transform.offsetZ
    );
    const radius = clearanceRadius(world, id);
    const originalX = world.props.x[id]!,
      originalZ = world.props.z[id]!;
    if (protectedVertices.has(Math.floor(originalZ) * stride + Math.floor(originalX)))
      throw new Error(
        "An attached source prop belongs to a protected plot, road, resource or authored feature."
      );
    if (
      x - radius < 0.1 ||
      z - radius < 0.1 ||
      x + radius >= world.cellsX - 0.1 ||
      z + radius >= world.cellsZ - 0.1
    )
      throw new Error("An attached native prop would extend beyond the map boundary.");
    for (let nz = Math.floor(z - radius); nz <= Math.ceil(z + radius); nz++)
      for (let nx = Math.floor(x - radius); nx <= Math.ceil(x + radius); nx++)
        if (protectedVertices.has(nz * stride + nx))
          throw new Error(
            "An attached prop would overlap a protected plot, road, unit, resource or authored feature."
          );
    candidate.props.x[id] = x;
    candidate.props.z[id] = z;
    // A prop landing on a cliff, in water or out of its habitat drops to a free spot later.
    if (losesLanding(world, candidate, id, { x: originalX, z: originalZ }, radius)) {
      stranded.add(id);
      continue;
    }
    const ground = sampleSmooth(candidate, candidate.heights, x, z);
    const surface = sampleBilinear(candidate, candidate.waterSurface, x, z);
    let y = ground;
    if (isAquaticDecoration(kind))
      y = kind === PROP.waterLily ? surface + LILY_FLOAT : getWaterlineFoot(ground, surface);
    if (!Number.isFinite(y)) throw new Error("The moved prop has no finite ground anchor.");
    candidate.props.y[id] = y;
    moves.push({ id, x, y: candidate.props.y[id]!, z });
  }
  // A carried prop crowding another one is re-seated at the nearest free spot instead.
  const crowded = findCrowdedProps(world, candidate, ids, new Set([...displaced, ...stranded]));
  for (const id of crowded) stranded.add(id);
  return moves.filter((move) => !crowded.has(move.id));
};

/**
 * Compare simultaneous final positions, including source/destination overlap; no intermediate
 * duplicates. Returns the carried props that would introduce or tighten a collision. Props that
 * are re-seated afterwards (`skipped`) are no obstacles here.
 */
const findCrowdedProps = (
  world: WorldData,
  candidate: WorldData,
  moved: ReadonlySet<number>,
  skipped: ReadonlySet<number>
) => {
  const crowded = new Set<number>();
  const buckets = new Map<number, number[]>(),
    stride = world.cellsX;
  for (let id = 0; id < candidate.props.count; id++) {
    if (!isStandingBlocker(world, id)) continue;
    const cell = Math.floor(candidate.props.z[id]!) * stride + Math.floor(candidate.props.x[id]!);
    const bucket = buckets.get(cell) ?? [];
    bucket.push(id);
    buckets.set(cell, bucket);
  }
  let comparisons = 0;
  for (const id of moved) {
    if (!isBlockingProp(world.props.types[id]!) || skipped.has(id)) continue;
    const x = candidate.props.x[id]!,
      z = candidate.props.z[id]!,
      radius = navigationPropRadius(candidate, id);
    for (
      let nz = Math.max(0, Math.floor(z - 2.4));
      nz <= Math.min(world.cellsZ - 1, Math.ceil(z + 2.4));
      nz++
    )
      for (
        let nx = Math.max(0, Math.floor(x - 2.4));
        nx <= Math.min(world.cellsX - 1, Math.ceil(x + 2.4));
        nx++
      )
        for (const other of buckets.get(nz * stride + nx) ?? []) {
          if (other === id || skipped.has(other) || crowded.has(other)) continue;
          if (moved.has(other) && other < id) continue;
          if (++comparisons > 1000000)
            throw new Error(
              "Prop collision preflight exceeded its bounded budget; no changes were applied."
            );
          const minimum = radius + navigationPropRadius(candidate, other);
          const after = Math.hypot(x - candidate.props.x[other]!, z - candidate.props.z[other]!);
          const before = Math.hypot(
            world.props.x[id]! - world.props.x[other]!,
            world.props.z[id]! - world.props.z[other]!
          );
          if (after + 0.01 < minimum && after + 0.01 < before) crowded.add(id);
        }
  }
  return crowded;
};
