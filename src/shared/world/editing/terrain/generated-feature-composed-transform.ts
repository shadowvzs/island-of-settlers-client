import { computeDistanceField } from "../../generation/distance-field";
import { createWetRock } from "../../generation/river-wetness";
import { getCellsRegion, unionRegions } from "../../grid-geometry";
import { invalidatePropCellIndex } from "../../prop-cell-index";
import { PROP_REMOVED, type WorldData } from "../../world-data";
import { isAuthoredRiverList } from "../authored-rivers";
import { isGeneratedRiverList } from "../generated-river-types";
import { commitFeatureTerrain } from "./generated-feature-commit";
import {
  attachedFeatureProps,
  featurePropTransformRegion,
  planFeaturePropMoves
} from "./generated-feature-props";
import { findDisplacedProps, reseatRegion, reseatUnrelatedProps } from "./generated-feature-reseat";
import { planFeatureResources } from "./generated-feature-resources";
import {
  containedRiverGroup,
  recarveRiverGroup,
  removeRiverGroup
} from "./generated-feature-river-group";
import { type FeatureTransformRuntime, protectFeatureRuntime } from "./generated-feature-runtime";
import type { GeneratedFeatureTransform } from "./generated-feature-transform";
import { assertSeedRestoreBoundary } from "./seed-restore-boundary";
import { seedRestoreProtectedVertices } from "./seed-restore-protection";
import { refreshEditedTerrain } from "./terrain-apply";
import type { TerrainComponent } from "./terrain-component";
import type { TerrainEditState } from "./terrain-edit-state";

type TerrainTransform = (
  world: WorldData,
  state: TerrainEditState,
  selection: TerrainComponent,
  transform: GeneratedFeatureTransform,
  runtime?: FeatureTransformRuntime,
  context?: { riverGroupRemoved?: boolean }
) => unknown;

const changedPrimaryVertices = (world: WorldData, draft: WorldData) => {
  const changed: number[] = [];
  for (let v = 0; v < world.heights.length; v++)
    if (
      world.heights[v] !== draft.heights[v] ||
      world.waterSurface[v] !== draft.waterSurface[v] ||
      world.waterDepth[v] !== draft.waterDepth[v] ||
      world.flow[v * 2] !== draft.flow[v * 2] ||
      world.flow[v * 2 + 1] !== draft.flow[v * 2 + 1]
    )
      changed.push(v);
  if (!changed.length) throw new Error("The course group transform does not change the terrain.");
  if (changed.length > 131072)
    throw new Error("The composed terrain exceeds the transform budget.");
  return changed;
};

/** Native recomposition happens exclusively on private complete world/state buffers. No actors,
 * resource ledgers, renderer callbacks or source primary arrays change before the final commit. */
export const transformFeatureWithRiverGroup = (
  world: WorldData,
  state: TerrainEditState,
  selection: TerrainComponent,
  transform: GeneratedFeatureTransform,
  runtime: FeatureTransformRuntime | undefined,
  transformTerrain: TerrainTransform
) => {
  const { group, owned, selected, sourceCells } = containedRiverGroup(world, selection);
  const bounds = getCellsRegion(world, selection.cells),
    stride = world.cellsX + 1;
  const affine = {
    ...transform,
    cx: (bounds.minX + bounds.maxX + 1) / 2,
    cz: (bounds.minZ + bounds.maxZ + 1) / 2
  };
  const attachmentSupport = new Set(owned);
  if (selection.kind === "relief")
    for (const cell of selection.cells) {
      const vertex = Math.floor(cell / world.cellsX) * stride + (cell % world.cellsX);
      for (const v of [vertex, vertex + 1, vertex + stride, vertex + stride + 1])
        if (world.heights[v]! > selection.threshold) attachmentSupport.add(v);
    }
  const attached = attachedFeatureProps(world, selection, attachmentSupport);
  for (const id of attached) {
    const refusal = runtime?.canMoveProp?.(id);
    if (refusal) throw new Error(refusal);
  }
  const resources = planFeatureResources(world, sourceCells, attached, affine, runtime);
  let draft = removeRiverGroup(structuredClone(world), group);
  const draftState = structuredClone(state);
  // Temporary removal is private planning only. Final native habitat/geometry checks happen after carving.
  for (const id of attached) draft.props.types[id] = PROP_REMOVED;
  draft.mineZone = resources.protectionWorld.mineZone.slice();
  draft.colonyStoneDeposits = structuredClone(resources.protectionWorld.colonyStoneDeposits);
  draft.scenario = structuredClone(resources.protectionWorld.scenario);
  if (selection.kind === "relief")
    transformTerrain(
      draft,
      draftState,
      selection,
      { ...transform, includeRivers: false },
      runtime,
      { riverGroupRemoved: true }
    );
  draft.props = structuredClone(world.props);
  draft = recarveRiverGroup(draft, world, group, selected, affine);
  if (
    !isGeneratedRiverList(draft.generatedRivers ?? [], world.cellsX, world.cellsZ) ||
    !isAuthoredRiverList(draft.authoredRivers ?? [], world.cellsX, world.cellsZ)
  )
    throw new Error(
      "The transformed native courses exceed their saved parameter or geometry bounds."
    );
  const changed = changedPrimaryVertices(world, draft);
  const region = unionRegions(
    getCellsRegion(
      world,
      changed.map(
        (v) =>
          Math.min(world.cellsZ - 1, Math.floor(v / stride)) * world.cellsX +
          Math.min(world.cellsX - 1, v % stride)
      )
    ),
    featurePropTransformRegion(world, attached, affine)
  );
  const protectionWorld: WorldData = {
    ...resources.protectionWorld,
    generatedRivers: world.generatedRivers?.filter((river) => !selected.has(`g:${river.id}`)),
    authoredRivers: world.authoredRivers?.filter((river) => !selected.has(`a:${river.id}`))
  };
  const protectedVertices = seedRestoreProtectedVertices(protectionWorld, state, region);
  protectFeatureRuntime(world, region, protectedVertices, runtime);
  for (const v of changed) {
    const graded =
      world.roadGradeApplied &&
      world.roadGradeBase &&
      Math.abs(world.roadGradeApplied[v]! - world.roadGradeBase[v]!) > 0.00001;
    if (protectedVertices.has(v) || graded)
      throw new Error(
        "The recomposed course touches an unrelated source, plot, road, actor or river."
      );
  }
  resources.validate(draft, protectedVertices);
  // Unrelated trees, rocks and plants on changed ground are re-seated, not refused.
  const displaced = findDisplacedProps(world, changed, attached, region),
    stranded = new Set<number>();
  const moved = planFeaturePropMoves(
    world,
    draft,
    attached,
    affine,
    protectedVertices,
    displaced,
    stranded
  );
  for (const id of stranded) displaced.add(id);
  moved.push(...reseatUnrelatedProps(world, draft, displaced, protectedVertices, runtime));
  // Native carvers may create legitimate steep banks. Treat their immediate bank ring as
  // one owned surface; the measured relief itself already passed its exact seam preflight.
  const boundarySupport = new Set(changed);
  const courseVertices = [
    ...owned,
    ...[...(draft.generatedRivers ?? []), ...(draft.authoredRivers ?? [])].flatMap((river) =>
      river.patches.map((patch) => patch.vertex)
    )
  ];
  for (const v of courseVertices)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = (v % stride) + dx,
          z = Math.floor(v / stride) + dz;
        if (x >= 0 && z >= 0 && x <= world.cellsX && z <= world.cellsZ)
          boundarySupport.add(z * stride + x);
      }
  for (const v of changed) {
    const x = v % stride,
      z = Math.floor(v / stride);
    if (x <= 0 || z <= 0 || x >= world.cellsX || z >= world.cellsZ)
      throw new Error("Keep the complete recomposed terrain inside the map border.");
    if (
      !owned.has(v) &&
      (world.waterDepth[v]! > 0.01 || Math.hypot(world.flow[v * 2]!, world.flow[v * 2 + 1]!) > 0.01)
    )
      throw new Error(
        "The resized course would join independent water. Edit the connected water group first."
      );
  }
  assertSeedRestoreBoundary(world, [...boundarySupport], draft);
  if (draft.lakeWater)
    for (const v of changed)
      if (draft.waterDepth[v]! <= 0.01 || draft.flow[v * 2] || draft.flow[v * 2 + 1])
        draft.lakeWater[v] = 0;
  commitFeatureTerrain(world, state, changed, draft);
  if (world.generatedRivers || draft.generatedRivers?.length)
    world.generatedRivers = draft.generatedRivers;
  if (world.authoredRivers || draft.authoredRivers?.length)
    world.authoredRivers = draft.authoredRivers;
  world.waterfalls = draft.waterfalls;
  const reseated = moved.filter(
    (move) =>
      displaced.has(move.id) &&
      (move.x !== world.props.x[move.id] || move.z !== world.props.z[move.id])
  ).length;
  for (const move of moved) {
    world.props.x[move.id] = move.x;
    world.props.y[move.id] = move.y;
    world.props.z[move.id] = move.z;
  }
  resources.commit();
  invalidatePropCellIndex(world);
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  world.riverDistance.set(
    computeDistanceField(
      world,
      (v) => world.waterDepth[v]! > 0.01 && !!(world.flow[v * 2] || world.flow[v * 2 + 1])
    )
  );
  world.wetRock.set(createWetRock(world, world.heights, world.riverDistance, world.waterfalls));
  const refreshed = reseatRegion(world, region, moved);
  refreshEditedTerrain(world, refreshed, true, undefined, new Set([...attached, ...displaced]));
  return {
    cells: refreshed,
    changed: changed.length,
    moved: moved.map((move) => move.id),
    movedOreZones: [...resources.zoneIds],
    movedStoneDeposits: [...resources.depositIds],
    movedRivers: group.map((layer) => layer.river.id),
    reseated
  };
};
