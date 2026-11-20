import { getCellsRegion, unionRegions } from "../../grid-geometry";
import { invalidatePropCellIndex } from "../../prop-cell-index";
import { MATERIAL_COUNT, type WorldData } from "../../world-data";
import { commitFeatureTerrain } from "./generated-feature-commit";
import { transformFeatureWithRiverGroup } from "./generated-feature-composed-transform";
import { assertDestinationWater, assertSeaStaysOpen } from "./generated-feature-destination-water";
import { assertClearTransform, hasFlowingWater } from "./generated-feature-guards";
import { clampFeatureOffset } from "./generated-feature-placement";
import {
  attachedFeatureProps,
  featurePropTransformRegion,
  planFeaturePropMoves
} from "./generated-feature-props";
import {
  carryLakeShorePaint,
  placeReliefLakes,
  sampleVertexValues
} from "./generated-feature-relief-lakes";
import { findDisplacedProps, reseatRegion, reseatUnrelatedProps } from "./generated-feature-reseat";
import { planFeatureResources } from "./generated-feature-resources";
import { hasSelectedRiver } from "./generated-feature-river-group";
import { moveContainedFeatureRiver } from "./generated-feature-river-move";
import { type FeatureTransformRuntime, protectFeatureRuntime } from "./generated-feature-runtime";
import { measureFeatureSource } from "./generated-feature-source";
import { taperFeatureEdge } from "./generated-feature-taper";
import { assertSeedRestoreBoundary } from "./seed-restore-boundary";
import { seedRestoreProtectedVertices } from "./seed-restore-protection";
import { refreshEditedTerrain } from "./terrain-apply";
import type { TerrainComponent } from "./terrain-component";
import type { TerrainEditState } from "./terrain-edit-state";

export interface GeneratedFeatureTransform {
  includeRivers?: boolean;
  offsetX: number;
  offsetZ: number;
  scale: number;
}

/** Composer-internal planning after an explicitly included river group has already been removed. */
interface TransformContext {
  riverGroupRemoved?: boolean;
}

const assertTransformInput = (
  world: WorldData,
  selection: TerrainComponent,
  { offsetX, offsetZ, scale }: GeneratedFeatureTransform
) => {
  if (
    ![offsetX, offsetZ, scale].every(Number.isFinite) ||
    scale < 0.5 ||
    scale > 2 ||
    Math.abs(offsetX) > world.cellsX ||
    Math.abs(offsetZ) > world.cellsZ
  )
    throw new Error("Use a finite offset and a size between 50% and 200%.");
  if (
    selection.truncated ||
    !selection.cells.length ||
    selection.cells.length > 32768 ||
    selection.cells.some(
      (cell) => !Number.isSafeInteger(cell) || cell < 0 || cell >= world.cellsX * world.cellsZ
    )
  )
    throw new Error("Select a complete bounded contour first.");
  if (!offsetX && !offsetZ && scale === 1)
    throw new Error("Choose a movement or a different size first.");
};

/** A lake selection whose water flows (a river course, moved as an owned channel). */
const isFlowingWaterSelection = (world: WorldData, selection: TerrainComponent) =>
  selection.kind === "water" &&
  selection.cells.some((cell) => {
    const vertex = Math.floor(cell / world.cellsX) * (world.cellsX + 1) + (cell % world.cellsX);
    return [vertex, vertex + 1, vertex + world.cellsX + 1, vertex + world.cellsX + 2].some(
      (index) => Math.hypot(world.flow[index * 2]!, world.flow[index * 2 + 1]!) > 0.01
    );
  });

/** A moved lake keeps its measured depths, with a new level at the lowest destination rim. */
const placeMovedLake = (
  world: WorldData,
  draft: { heights: Float32Array; lakeWater: Uint8Array; waterSurface: Float32Array },
  destinations: readonly { amplitude: number; index: number }[]
) => {
  const stride = world.cellsX + 1,
    inside = new Set(destinations.map((entry) => entry.index));
  let level = Infinity;
  for (const { index } of destinations)
    for (const neighbour of [index - 1, index + 1, index - stride, index + stride])
      if (!inside.has(neighbour)) level = Math.min(level, draft.heights[neighbour]!);
  if (!Number.isFinite(level) || level <= world.seaLevel + 0.1)
    throw new Error("The destination lake needs a dry enclosed rim above sea level.");
  for (const { amplitude, index } of destinations) {
    draft.heights[index] = level - amplitude;
    draft.waterSurface[index] = level;
    draft.lakeWater[index] = 1;
  }
};

export const transformGeneratedFeature = (
  world: WorldData,
  state: TerrainEditState,
  selection: TerrainComponent,
  requested: GeneratedFeatureTransform,
  runtime?: FeatureTransformRuntime,
  context?: TransformContext
) => {
  assertTransformInput(world, selection, requested);
  const bounds = getCellsRegion(world, selection.cells),
    stride = world.cellsX + 1;
  if (
    bounds.minX <= 0 ||
    bounds.minZ <= 0 ||
    bounds.maxX >= world.cellsX - 1 ||
    bounds.maxZ >= world.cellsZ - 1
  )
    throw new Error("World-edge contours cannot move or resize.");
  // A move or resize crossing the map border is pulled back to the nearest offset that fits.
  const placement = clampFeatureOffset(world, bounds, requested);
  const transform = { ...requested, offsetX: placement.offsetX, offsetZ: placement.offsetZ };
  const { offsetX, offsetZ, scale } = transform;
  // Relief cut through flowing water must not move the river implicitly: that is the explicit
  // "include complete river courses" choice. The composer's own post-removal pass is exempt.
  const containsFlowingRiver = selection.kind === "relief" && hasFlowingWater(world, selection);
  if (containsFlowingRiver && !transform.includeRivers && !context?.riverGroupRemoved)
    throw new Error(
      "This relief contains a flowing river. Include the complete connected river course to move it, or choose a dry contour."
    );
  // A river running through the relief moves with it (its connected course is recarved).
  const movesRivers = transform.includeRivers && hasSelectedRiver(world, selection);
  if (movesRivers || containsFlowingRiver)
    return {
      ...placement,
      ...transformFeatureWithRiverGroup(
        world,
        state,
        selection,
        transform,
        runtime,
        transformGeneratedFeature
      )
    };
  if (isFlowingWaterSelection(world, selection))
    return {
      ...placement,
      reseated: 0,
      ...moveContainedFeatureRiver(world, state, selection, transform, runtime)
    };
  const cx = (bounds.minX + bounds.maxX + 1) / 2,
    cz = (bounds.minZ + bounds.maxZ + 1) / 2;
  const affine = { cx, cz, offsetX, offsetZ, scale };
  const { lake, lakes, plane, source } = measureFeatureSource(world, selection, bounds);
  const attached = attachedFeatureProps(world, selection, new Set(source.keys()));
  for (const id of attached) {
    const refusal = runtime?.canMoveProp?.(id);
    if (refusal) throw new Error(refusal);
  }
  // Zero beyond the measured support: interpolation retains the actual irregular contour.
  const sourcePoint = (vertex: number) => ({
    x: cx + ((vertex % stride) - cx - offsetX) / scale,
    z: cz + (Math.floor(vertex / stride) - cz - offsetZ) / scale
  });
  let profileSlope = 0.7;
  for (const [index, amplitude] of source)
    for (const neighbour of [index - 1, index + 1, index - stride, index + stride])
      profileSlope = Math.max(
        profileSlope,
        Math.abs(amplitude - (source.get(neighbour) ?? 0)) / scale
      );
  const heights = Float32Array.from(world.heights),
    waterSurface = Float32Array.from(world.waterSurface);
  const lakeWater = world.lakeWater
    ? Uint8Array.from(world.lakeWater)
    : new Uint8Array(heights.length);
  const draft = { heights, lakeWater, waterSurface };
  for (const index of source.keys()) {
    heights[index] = plane;
    waterSurface[index] = Math.min(waterSurface[index]!, heights[index]!);
    lakeWater[index] = 0;
  }
  const left = Math.floor(cx + (bounds.minX - cx) * scale + offsetX) - 1;
  const right = Math.ceil(cx + (bounds.maxX + 1 - cx) * scale + offsetX) + 1;
  const top = Math.floor(cz + (bounds.minZ - cz) * scale + offsetZ) - 1;
  const bottom = Math.ceil(cz + (bounds.maxZ + 1 - cz) * scale + offsetZ) + 1;
  if (source.size * scale * scale > 131072)
    throw new Error("Transformed terrain exceeds the editing budget.");
  const destinations: { index: number; amplitude: number }[] = [];
  for (let z = top; z <= bottom; z++)
    for (let x = left; x <= right; x++) {
      const index = z * stride + x,
        point = sourcePoint(index);
      const amplitude = sampleVertexValues(world, source, point.x, point.z);
      if (Math.abs(amplitude) > 0.00001) destinations.push({ index, amplitude });
    }
  const destinationVertices = destinations.map((entry) => entry.index);
  assertDestinationWater(world, destinationVertices, source, lake);
  if (lake) placeMovedLake(world, draft, destinations);
  else
    for (const { amplitude, index } of destinations) heights[index] = heights[index]! + amplitude;
  placeReliefLakes(world, draft, lakes, destinationVertices, sourcePoint);
  // Only vertices whose ground really moved anchor the taper (a cut at the plane may be a no-op).
  const edited = new Set(
    [...source.keys(), ...destinationVertices].filter(
      (index) => heights[index] !== world.heights[index]
    )
  );
  const tapered = taperFeatureEdge(world, heights, edited);
  const splat = lakes.length ? world.splat.slice() : world.splat;
  const painted = new Set(
    carryLakeShorePaint(world, splat, lakes, destinationVertices, sourcePoint)
  );
  const changed = [
    ...new Set([...source.keys(), ...destinationVertices, ...tapered, ...painted])
  ].filter(
    (index) =>
      painted.has(index) ||
      heights[index] !== world.heights[index] ||
      waterSurface[index] !== world.waterSurface[index] ||
      lakeWater[index] !== (world.lakeWater?.[index] ?? 0)
  );
  if (!changed.length) throw new Error("The transform does not change any terrain points.");
  const terrainRegion = getCellsRegion(
    world,
    changed.map(
      (index) =>
        Math.min(world.cellsZ - 1, Math.floor(index / stride)) * world.cellsX +
        Math.min(world.cellsX - 1, index % stride)
    )
  );
  const region = unionRegions(
    unionRegions(terrainRegion, {
      minX: Math.min(bounds.minX, left),
      minZ: Math.min(bounds.minZ, top),
      maxX: Math.max(bounds.maxX, right),
      maxZ: Math.max(bounds.maxZ, bottom)
    }),
    featurePropTransformRegion(world, attached, affine)
  );
  const resources = planFeatureResources(
    world,
    new Set(selection.cells),
    attached,
    affine,
    runtime
  );
  const protectedVertices = seedRestoreProtectedVertices(resources.protectionWorld, state, region);
  protectFeatureRuntime(world, region, protectedVertices, runtime);
  const candidate: WorldData = {
    ...world,
    heights,
    waterSurface,
    lakeWater,
    waterDepth: Float32Array.from(heights, (height, index) =>
      Math.max(0, waterSurface[index]! - height)
    ),
    props: {
      ...world.props,
      x: world.props.x.slice(),
      y: world.props.y.slice(),
      z: world.props.z.slice()
    }
  };
  resources.validate(candidate, protectedVertices);
  const displaced = findDisplacedProps(world, changed, attached, region),
    stranded = new Set<number>();
  const moved = planFeaturePropMoves(
    world,
    candidate,
    attached,
    affine,
    protectedVertices,
    displaced,
    stranded
  );
  // Carried props that cannot land where the relief puts them drop to the nearest free spot.
  for (const id of stranded) displaced.add(id);
  assertClearTransform(world, changed, { heights, profileSlope, protectedVertices });
  const reseated = reseatUnrelatedProps(world, candidate, displaced, protectedVertices, runtime);
  assertSeaStaysOpen(world, { flow: world.flow, heights, lakeWater, waterSurface }, changed);
  assertSeedRestoreBoundary(world, changed, { heights, waterSurface });
  const relocated = reseated.filter(
    (move) => move.x !== world.props.x[move.id] || move.z !== world.props.z[move.id]
  ).length;
  for (const index of painted)
    world.splat.set(
      splat.subarray(index * MATERIAL_COUNT, (index + 1) * MATERIAL_COUNT),
      index * MATERIAL_COUNT
    );
  commitFeatureTerrain(world, state, changed, draft);
  for (const move of [...moved, ...reseated]) {
    world.props.x[move.id] = move.x;
    world.props.y[move.id] = move.y;
    world.props.z[move.id] = move.z;
  }
  resources.commit();
  if (moved.length || reseated.length || resources.zoneIds.size || resources.depositIds.size) {
    invalidatePropCellIndex(world);
    world.buildRevision = (world.buildRevision ?? 0) + 1;
  }
  const refreshed = reseatRegion(world, region, reseated);
  const anchored = new Set([...attached, ...reseated.map((move) => move.id)]);
  refreshEditedTerrain(world, refreshed, true, undefined, anchored);
  return {
    ...placement,
    cells: refreshed,
    changed: changed.length,
    moved: [...moved, ...reseated].map((move) => move.id),
    movedOreZones: [...resources.zoneIds],
    movedStoneDeposits: [...resources.depositIds],
    reseated: relocated
  };
};
