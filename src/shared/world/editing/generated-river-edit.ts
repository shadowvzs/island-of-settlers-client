import { computeDistanceField } from "../generation/distance-field";
import { createWetRock } from "../generation/river-wetness";
import { type CellRegion,EMPTY_REGION, sampleSmooth } from "../grid-geometry";
import type { WorldData } from "../world-data";
import { applyAuthoredRiver, isAuthoredRiverList } from "./authored-rivers";
import { type GeneratedRiver,isGeneratedRiverList } from "./generated-river-types";
import { removePropsAt } from "./prop-removal";
import { composeRiverEdit } from "./river-composition";
import { captureRiverLayers, getRiverEditRegion } from "./river-edit-region";
import { validateRiverSuppressionBudget } from "./river-water-suppression";
import { refreshEditedTerrain } from "./terrain/terrain-apply";

/** Compose the selected channel and its dependent layers on private primary buffers. */
export const editGeneratedRiver = (world: WorldData, change: GeneratedRiver | null,
  removeId?: number, reshape = false, beforeCommit?: (vertices: readonly number[]) => void
): CellRegion & { removed: number[]; baseVertices: number[] } => {
  const id = change?.id ?? removeId, previous = world.generatedRivers?.find(river => river.id === id);
  if (!previous) throw new Error("Selected generated river no longer exists; select a current definition.");
  if (change && !isGeneratedRiverList([change], world.cellsX, world.cellsZ))
    throw new Error("Generated river parameters or sampled course are invalid.");
  if (change && !reshape && change.widthScale === previous.widthScale &&
    change.depthScale === previous.depthScale && change.points.length === previous.points.length &&
    JSON.stringify(change.suppressedVertices) === JSON.stringify(previous.suppressedVertices) &&
    change.points.every((point, i) => point.x === previous.points[i]!.x && point.z === previous.points[i]!.z))
    return { ...EMPTY_REGION, removed: [], baseVertices: [] };
  const { authored, baseVertices, draft, generated: rivers } = composeRiverEdit(world,
    { generated: true, id: previous.id, river: change, reshape }, applyAuthoredRiver);
  validateRiverSuppressionBudget([...rivers, ...authored], world.heights.length);
  if (!isGeneratedRiverList(rivers, world.cellsX, world.cellsZ) ||
    !isAuthoredRiverList(authored, world.cellsX, world.cellsZ))
    throw new Error("River composition exceeds the bounded saved-definition budget.");
  // Reconstruct wet flowing beds, excluding native flow vectors retained on dry levees.
  // The historical mask is not persisted; do not claim an identical original estuary mask.
  // Dependants refresh once, after the selected edit succeeds.
  draft.riverDistance = computeDistanceField(draft, i => draft.waterDepth[i]! > 0 &&
    !!(draft.flow[i * 2] || draft.flow[i * 2 + 1]));
  const removed: number[] = [];
  for (let prop = 0; prop < world.props.count; prop++) {
    const x = world.props.x[prop]!, z = world.props.z[prop]!;
    if (world.props.types[prop] !== 255 && sampleSmooth(world, world.waterDepth, x, z) <= .15 &&
      sampleSmooth(draft, draft.waterDepth, x, z) > .15) removed.push(prop);
  }
  beforeCommit?.(baseVertices);
  const before = captureRiverLayers(world);
  world.heights.set(draft.heights); world.waterSurface.set(draft.waterSurface);
  world.waterDepth.set(draft.waterDepth); world.flow.set(draft.flow); world.riverDistance.set(draft.riverDistance);
  world.waterfalls = draft.waterfalls; world.generatedRivers = rivers;
  if (world.authoredRivers || authored.length) world.authoredRivers = authored;
  if (draft.lakeWater) world.lakeWater?.set(draft.lakeWater);
  world.wetRock.set(createWetRock(world, world.heights, world.riverDistance, world.waterfalls));
  const cells = getRiverEditRegion(world, before);
  refreshEditedTerrain(world, cells, false);
  removePropsAt(world, removed);
  return { ...cells, removed, baseVertices };
};
