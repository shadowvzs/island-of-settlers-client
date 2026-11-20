import { computeDistanceField } from "../../generation/distance-field";
import { createWetRock } from "../../generation/river-wetness";
import { getCellsRegion, unionRegions } from "../../grid-geometry";
import { invalidatePropCellIndex } from "../../prop-cell-index";
import { PROP_REMOVED, type Waterfall, type WorldData } from "../../world-data";
import type { AuthoredRiver } from "../authored-rivers";
import type { GeneratedRiver } from "../generated-river-types";
import {
  attachedFeatureProps,
  featurePropTransformRegion,
  planFeaturePropMoves
} from "./generated-feature-props";
import { planFeatureResources } from "./generated-feature-resources";
import {
  collectRiverOwnership,
  planRiverChannel,
  riverMoveValues,
  writeRiverMoveValues
} from "./generated-feature-river-plan";
import { type FeatureTransformRuntime,protectFeatureRuntime } from "./generated-feature-runtime";
import { assertSeedRestoreBoundary } from "./seed-restore-boundary";
import { seedRestoreProtectedVertices } from "./seed-restore-protection";
import { refreshEditedTerrain } from "./terrain-apply";
import type { TerrainComponent } from "./terrain-component";
import type { TerrainEditState } from "./terrain-edit-state";

const sameFall = (a: Waterfall, b: Waterfall) =>
  Object.keys(a).every((key) => a[key as keyof Waterfall] === b[key as keyof Waterfall]);

/** Exact owned-channel translation. Destination slopes must preserve the saved river's grade.
 * No hidden lake underlay, overlap composition or lossy flow resampling is invented. */
export const moveContainedFeatureRiver = (
  world: WorldData,
  state: TerrainEditState,
  selection: TerrainComponent,
  transform: { offsetX: number; offsetZ: number; scale: number },
  runtime?: FeatureTransformRuntime
) => {
  const { all, cells, owned, rivers, stride } = collectRiverOwnership(world, selection, transform);
  const attached = attachedFeatureProps(world, selection, owned);
  for (const id of attached) {
    const refusal = runtime?.canMoveProp?.(id);
    if (refusal) throw new Error(refusal);
  }
  const { affected, draft, movedRivers } = planRiverChannel(world, all, rivers, owned, transform);
  const sourceCells = new Set(cells);
  for (const vertex of owned)
    for (const dz of [-1, 0])
      for (const dx of [-1, 0]) {
        const x = (vertex % stride) + dx,
          z = Math.floor(vertex / stride) + dz;
        if (x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ)
          sourceCells.add(z * world.cellsX + x);
      }
  const resources = planFeatureResources(
    world,
    sourceCells,
    attached,
    { ...transform, cx: 0, cz: 0 },
    runtime
  );
  const region = unionRegions(
    featurePropTransformRegion(world, attached, { ...transform, cx: 0, cz: 0 }),
    getCellsRegion(
      world,
      [...affected].map(
        (vertex) =>
          Math.min(world.cellsZ - 1, Math.floor(vertex / stride)) * world.cellsX +
          Math.min(world.cellsX - 1, vertex % stride)
      )
    )
  );
  const protectionWorld = {
    ...resources.protectionWorld,
    authoredRivers: world.authoredRivers?.filter((river) => !rivers.includes(river)),
    generatedRivers: world.generatedRivers?.filter((river) => !rivers.includes(river))
  };
  const protectedVertices = seedRestoreProtectedVertices(protectionWorld, state, region);
  protectFeatureRuntime(world, region, protectedVertices, runtime);
  for (let prop = 0; prop < world.props.count; prop++) {
    if (attached.has(prop) || world.props.types[prop] === PROP_REMOVED) continue;
    const x = Math.floor(world.props.x[prop]!),
      z = Math.floor(world.props.z[prop]!);
    for (let dz = -2; dz <= 3; dz++)
      for (let dx = -2; dx <= 3; dx++)
        if (x + dx >= 0 && z + dz >= 0 && x + dx <= world.cellsX && z + dz <= world.cellsZ)
          protectedVertices.add((z + dz) * stride + x + dx);
  }
  if ([...affected].some((vertex) => world.lakeWater?.[vertex]))
    throw new Error(
      "This flowing group shares an independently authored lake layer. Edit its course first."
    );
  for (const vertex of affected)
    if (
      protectedVertices.has(vertex) ||
      (world.roadGradeApplied &&
        world.roadGradeBase &&
        Math.abs(world.roadGradeApplied[vertex]! - world.roadGradeBase[vertex]!) > 0.00001)
    )
      throw new Error(
        "The flowing channel move overlaps a protected plot, road, resource or active job."
      );
  resources.validate(draft, protectedVertices);
  const moved = planFeaturePropMoves(
    world,
    draft,
    attached,
    { ...transform, cx: 0, cz: 0 },
    protectedVertices
  );
  assertSeedRestoreBoundary(world, [...affected], draft);
  // Everything above is private: no partial source removal survives a failed preflight.
  state.base ??= {
    heights: world.heights.slice(),
    waterSurface: world.waterSurface.slice(),
    splat: world.splat.slice()
  };
  for (const vertex of affected) {
    writeRiverMoveValues(world, vertex, riverMoveValues(draft, vertex));
    state.base.heights[vertex] = world.heights[vertex]!;
    state.base.waterSurface[vertex] = world.waterSurface[vertex]!;
    if (state.rise) state.rise[vertex] = 0;
    if (state.ring) state.ring[vertex] = 0;
    if (state.lake) state.lake[vertex] = 0;
  }
  const oldFalls = rivers.flatMap((river) => river.falls);
  world.waterfalls = world.waterfalls.filter(
    (fall) => !oldFalls.some((own) => sameFall(own, fall))
  );
  world.waterfalls.push(...[...movedRivers.values()].flatMap((river) => river.falls));
  world.authoredRivers = world.authoredRivers?.map(
    (river) => (movedRivers.get(river) ?? river) as AuthoredRiver
  );
  world.generatedRivers = world.generatedRivers?.map(
    (river) => (movedRivers.get(river) ?? river) as GeneratedRiver
  );
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
      (vertex) =>
        world.waterDepth[vertex]! > 0.01 && !!(world.flow[vertex * 2] || world.flow[vertex * 2 + 1])
    )
  );
  world.wetRock.set(createWetRock(world, world.heights, world.riverDistance, world.waterfalls));
  refreshEditedTerrain(world, region, true, undefined, attached);
  return {
    cells: region,
    changed: affected.size,
    moved: moved.map((move) => move.id),
    movedOreZones: [...resources.zoneIds],
    movedStoneDeposits: [...resources.depositIds],
    movedRivers: rivers.map((river) => river.id)
  };
};
