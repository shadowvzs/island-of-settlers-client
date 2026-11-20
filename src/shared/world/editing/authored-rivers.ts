import { DMath } from "../../math/deterministic-math";
import { carveRivers } from "../generation/river-carving";
import { resamplePath, smoothPath } from "../generation/river-line";
import { type CellRegion,EMPTY_REGION, sampleSmooth } from "../grid-geometry";
import type { Waterfall, WorldData } from "../world-data";
import { createEditGround, type EditGround } from "./build-refresh";
import { isGeneratedRiverList } from "./generated-river-types";
import { removePropsAt } from "./prop-removal";
import { composeRiverEdit } from "./river-composition";
import { captureRiverLayers, getRiverEditRegion } from "./river-edit-region";
import {
  applyRiverSuppression, refreshRiverWaterDerived, riverFallSuppressed,
validateRiverSuppressionBudget,
  validRiverSuppression} from "./river-water-suppression";
import { refreshEditedTerrain } from "./terrain/terrain-apply";

const editingGround = new WeakMap<WorldData, { ground: EditGround; revision: number; build: number }>();
export const prepareRiverEditing = (world: WorldData) => {
  const cached = editingGround.get(world);
  if (!cached || cached.revision !== (world.terrainRevision ?? 0) || cached.build !== (world.buildRevision ?? 0))
    editingGround.set(world, { ground: createEditGround(world), revision: world.terrainRevision ?? 0,
      build: world.buildRevision ?? 0 });
};
/** Refreshes the edited river region (`getRiverEditRegion` already refreshed the coast distance). */
const refreshRiverTerrain = (world: WorldData, cells: CellRegion) => {
  const ground = refreshEditedTerrain(world, cells, false, editingGround.get(world)?.ground);
  editingGround.set(world, { ground, revision: world.terrainRevision ?? 0, build: world.buildRevision ?? 0 });
};

export interface RiverPoint { x: number; z: number }
/** Sparse original/applied values permit removal without undoing later manual terrain edits. */
export interface AuthoredRiver {
  id: number;
  points: RiverPoint[];
  width: number;
  depth: number;
  patches: { vertex: number; before: number[]; after: number[] }[];
  falls: Waterfall[];
  /** Fixed map-space water erasures; retained when the course is moved or resized. */
  suppressedVertices?: number[];
}
const read = (world: WorldData, i: number) => [world.heights[i]!, world.waterSurface[i]!,
  world.waterDepth[i]!, world.flow[i * 2]!, world.flow[i * 2 + 1]!, world.riverDistance[i]!];
const write = (world: WorldData, i: number, values: number[]) => {
  world.heights[i] = values[0]!; world.waterSurface[i] = values[1]!; world.waterDepth[i] = values[2]!;
  world.flow[i * 2] = values[3]!; world.flow[i * 2 + 1] = values[4]!; world.riverDistance[i] = values[5]!;
};
export const applyAuthoredRiver = (world: WorldData, river: AuthoredRiver) => {
  const points = resamplePath(smoothPath(river.points));
  const mouthStep = points.findIndex(point => {
    const i = Math.round(point.z) * (world.cellsX + 1) + Math.round(point.x);
    return world.heights[i]! <= world.seaLevel;
  });
  const heights = world.heights.slice();
  const layers = carveRivers(world, heights, [{ points, mouthStep: mouthStep < 0 ? points.length - 1 : mouthStep }],
    world.seaLevel, () => river.width);
  river.patches = [];
  for (let i = 0; i < heights.length; i++) {
    const surface = layers.surface[i]!;
    if (heights[i] === world.heights[i] && !layers.mask[i]) continue;
    const before = read(world, i), after = [...before];
    after[0] = heights[i]!;
    if (layers.mask[i] && Number.isFinite(surface)) {
      after[0] = Math.min(after[0]!, surface - river.depth);
      after[1] = surface; after[2] = Math.max(0, surface - after[0]!);
      after[3] = layers.flow[i * 2]!; after[4] = layers.flow[i * 2 + 1]!; after[5] = 0;
    }
    write(world, i, after);
    river.patches.push({ vertex: i, before, after: read(world, i) });
  }
  const mask = applyRiverSuppression(world, river, new Set(river.patches.map(patch => patch.vertex)));
  for (const patch of river.patches) patch.after = read(world, patch.vertex);
  river.falls = layers.waterfalls.filter(fall => !riverFallSuppressed(world, fall, mask));
  world.waterfalls.push(...river.falls);
};
/** Rebuild connected authored channels once per stroke, using the generator's profiles and falls. */
export const editAuthoredRiver = (world: WorldData, change: Omit<AuthoredRiver, "patches" | "falls"> | null,
  removeId?: number, beforeCommit?: (vertices: readonly number[]) => void): CellRegion & { removed: number[]; baseVertices?: number[] } => {
  if (change && (change.points.length < 2 || change.points.length > 2048 ||
    !Number.isFinite(change.width) || change.width < 1 || change.width > 6 ||
    !Number.isFinite(change.depth) || change.depth < .2 || change.depth > 3 ||
    change.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.z) ||
      point.x < 0 || point.z < 0 || point.x > world.cellsX || point.z > world.cellsZ) ||
    change.points.slice(1).reduce((sum, point, i) => sum + DMath.hypot(point.x - change.points[i]!.x,
      point.z - change.points[i]!.z), 0) < .5))
    throw new Error("River needs a finite connected channel inside the map");
  const previous = world.authoredRivers?.find(river => river.id === change?.id);
  if (change && previous && change.width === previous.width && change.depth === previous.depth &&
    JSON.stringify(change.points) === JSON.stringify(previous.points) &&
    JSON.stringify(change.suppressedVertices) === JSON.stringify(previous.suppressedVertices))
    return { ...EMPTY_REGION, removed: [], baseVertices: [] };
  prepareRiverEditing(world);
  const rivers = world.authoredRivers ?? [];
  validateRiverSuppressionBudget([...rivers, ...world.generatedRivers ?? []], world.heights.length);
  if (change && !validRiverSuppression(change.suppressedVertices, world.heights.length))
    throw new Error("Invalid river water-erasure mask");
  const affected = rivers.flatMap(river => river.points);
  if (change) affected.push(...change.points);
  if (!affected.length) return { ...EMPTY_REGION, removed: [] };
  // Stage native carving before committing: invalid profiles or allocation failures must not
  // leave half the old rivers removed, or partially rewritten reverse-patch metadata.
  const { authored, baseVertices, draft, generated } = composeRiverEdit(world,
    { generated: false, id: change?.id ?? removeId ?? -1,
      river: change ? { ...structuredClone(change), falls: [], patches: [] } : null }, applyAuthoredRiver);
  validateRiverSuppressionBudget([...authored, ...generated], world.heights.length);
  if (!isAuthoredRiverList(authored, world.cellsX, world.cellsZ) ||
    !isGeneratedRiverList(generated, world.cellsX, world.cellsZ))
    throw new Error("River composition exceeds the bounded saved-definition budget.");
  const removed: number[] = [];
  for (let id = 0; id < world.props.count; id++) {
    const x = world.props.x[id]!, z = world.props.z[id]!;
    if (world.props.types[id] !== 255 && sampleSmooth(world, world.waterDepth, x, z) <= .15 &&
      sampleSmooth(draft, draft.waterDepth, x, z) > .15) removed.push(id);
  }
  beforeCommit?.(baseVertices);
  const before = captureRiverLayers(world);
  world.heights.set(draft.heights); world.waterSurface.set(draft.waterSurface);
  world.waterDepth.set(draft.waterDepth); world.flow.set(draft.flow); world.riverDistance.set(draft.riverDistance);
  world.waterfalls = draft.waterfalls; world.authoredRivers = authored;
  if (world.generatedRivers || generated.length) world.generatedRivers = generated;
  if (draft.lakeWater) world.lakeWater?.set(draft.lakeWater);
  refreshRiverWaterDerived(world);
  const cells = getRiverEditRegion(world, before);
  refreshRiverTerrain(world, cells);
  removePropsAt(world, removed);
  return { ...cells, removed, baseVertices };
};

export const isAuthoredRiverList = (value: unknown, cellsX: number, cellsZ: number): value is AuthoredRiver[] => {
  if (!Array.isArray(value) || value.length > 16) return false;
  const vertices = (cellsX + 1) * (cellsZ + 1), ids = new Set<number>();
  let patches = 0;
  for (const river of value) {
    if (!river || !Number.isSafeInteger(river.id) || river.id < 1 || ids.has(river.id) ||
      !Number.isFinite(river.width) || river.width < 1 || river.width > 6 ||
      !Number.isFinite(river.depth) || river.depth < .2 || river.depth > 3 ||
      !Array.isArray(river.points) || river.points.length < 2 || river.points.length > 2048 ||
      !Array.isArray(river.patches) || !Array.isArray(river.falls) ||
      !validRiverSuppression(river.suppressedVertices, vertices)) return false;
    ids.add(river.id); patches += river.patches.length;
    if (patches > vertices * 4) return false;
    for (const point of river.points) if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z) ||
      point.x < 0 || point.z < 0 || point.x > cellsX || point.z > cellsZ) return false;
    if (river.points.slice(1).reduce((sum: number, point: RiverPoint, i: number) =>
      sum + DMath.hypot(point.x - river.points[i]!.x, point.z - river.points[i]!.z), 0) < .5) return false;
    const seen = new Set<number>();
    for (const patch of river.patches) {
      if (!patch || !Number.isSafeInteger(patch.vertex) || patch.vertex < 0 || patch.vertex >= vertices ||
        seen.has(patch.vertex) || ![patch.before, patch.after].every(values => Array.isArray(values) &&
          values.length === 6 && values.every(Number.isFinite))) return false;
      seen.add(patch.vertex);
    }
    if (river.falls.length > 2048 || river.falls.some((fall: Waterfall) => !fall ||
      ![fall.x, fall.z, fall.top, fall.bottom, fall.directionX, fall.directionZ, fall.width,
        fall.poolRadius, fall.poolX, fall.poolZ].every(Number.isFinite))) return false;
  }
  try { validateRiverSuppressionBudget(value, vertices); } catch { return false; }
  return true;
};

export { checkRiverWaterErasure, eraseRiverWater } from "./river-water-eraser";
