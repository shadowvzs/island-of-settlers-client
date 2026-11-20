import { DMath } from "../../math/deterministic-math";
import type { CellRegion } from "../grid-geometry";
import type { WorldData } from "../world-data";
import { captureRiverLayers, getRiverEditRegion } from "./river-edit-region";
import {
  refreshRiverWaterDerived, riverFallSuppressed, suppressRiverVertex, validateRiverSuppressionBudget
} from "./river-water-suppression";
import { refreshEditedTerrain } from "./terrain/terrain-apply";

export const checkRiverWaterErasure = (_world: WorldData, point: { x: number; z: number }, radius: number) => {
  if (![point.x, point.z, radius].every(Number.isFinite) || radius <= 0)
    throw new Error("Water eraser needs a finite position and positive radius");
};

/** Erasure is map-space, additive and water-only, including across multiple editable channels. */
export const eraseRiverWater = (world: WorldData, point: { x: number; z: number }, radius: number,
  beforeCommit?: (vertices: readonly number[]) => void
): CellRegion & { removed: number[]; baseVertices: number[] } => {
  checkRiverWaterErasure(world, point, radius);
  const cells = { minX: Math.max(0, Math.floor(point.x - radius)), minZ: Math.max(0, Math.floor(point.z - radius)),
    maxX: Math.min(world.cellsX - 1, Math.ceil(point.x + radius)),
    maxZ: Math.min(world.cellsZ - 1, Math.ceil(point.z + radius)) };
  const vertices = new Set<number>(), stride = world.cellsX + 1;
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++) for (let x = cells.minX; x <= cells.maxX + 1; x++)
    if (DMath.hypot(x - point.x, z - point.z) <= radius) vertices.add(z * stride + x);
  const falls = world.waterfalls.filter(fall => DMath.hypot(fall.x - point.x, fall.z - point.z) <= radius ||
    DMath.hypot(fall.poolX - point.x, fall.poolZ - point.z) <= radius);
  for (const fall of falls) vertices.add(Math.max(0, Math.min(world.cellsZ, Math.round(fall.z))) * stride +
    Math.max(0, Math.min(world.cellsX, Math.round(fall.x))));
  const authored = structuredClone(world.authoredRivers ?? []);
  const generated = structuredClone(world.generatedRivers ?? []);
  for (const river of [...authored, ...generated]) {
    if (!river.patches.some(patch => vertices.has(patch.vertex)) &&
      !river.falls.some(fall => riverFallSuppressed(world, fall, vertices))) continue;
    river.suppressedVertices = [...new Set([...river.suppressedVertices ?? [], ...vertices])].sort((a, b) => a - b);
  }
  validateRiverSuppressionBudget([...authored, ...generated], world.heights.length);
  const draft = { ...world, waterSurface: world.waterSurface.slice(), waterDepth: world.waterDepth.slice(),
    flow: world.flow.slice(), lakeWater: world.lakeWater?.slice() };
  const owned = new Set([...authored, ...generated].flatMap(river => river.suppressedVertices ?? []));
  for (const vertex of vertices) {
    if (owned.has(vertex) || draft.flow[vertex * 2] || draft.flow[vertex * 2 + 1] ||
      world.riverDistance[vertex]! <= 1)
      suppressRiverVertex(draft, vertex);
  }
  for (const river of [...authored, ...generated]) {
    const mask = new Set(river.suppressedVertices ?? []);
    river.falls = river.falls.filter(fall => !riverFallSuppressed(world, fall, mask));
    for (const patch of river.patches) if (vertices.has(patch.vertex) && mask.has(patch.vertex)) {
      // Do not claim an independently painted height by replacing after[0].
      patch.after[1] = draft.waterSurface[patch.vertex]!; patch.after[2] = draft.waterDepth[patch.vertex]!;
      patch.after[3] = draft.flow[patch.vertex * 2]!; patch.after[4] = draft.flow[patch.vertex * 2 + 1]!;
    }
  }
  beforeCommit?.([...vertices]);
  const before = captureRiverLayers(world);
  world.waterSurface.set(draft.waterSurface); world.waterDepth.set(draft.waterDepth); world.flow.set(draft.flow);
  if (draft.lakeWater) world.lakeWater?.set(draft.lakeWater);
  if (world.authoredRivers) world.authoredRivers = authored;
  if (world.generatedRivers) world.generatedRivers = generated;
  world.waterfalls = world.waterfalls.filter(fall => !riverFallSuppressed(world, fall, vertices));
  refreshRiverWaterDerived(world);
  const changed = getRiverEditRegion(world, before);
  refreshEditedTerrain(world, changed, false);
  return { ...changed, removed: [], baseVertices: [...vertices] };
};
