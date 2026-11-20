import { canLevelRoadGround } from "./road-ground-leveling";
import { createRoadNetwork } from "./road-network";
import { isRoadVergeClear, parallelRoadConflict } from "./road-reserved-strip";
import { roadIntersectsVisibleRock } from "./road-rock-footprints";
import { createRoadTraversal } from "./road-traversal";
import { ROAD_STONE_WIDTH, type RoadPoint, type RoadSegment } from "./road-types";
import { createSignpostStakes } from "./settlement-road-strip-placement";
import type { SettlementContext } from "./settlement-types";

const constructionOptions = (context: SettlementContext) => {
  const { world } = context.options;
  const signs = createSignpostStakes(world, () => context.buildings);
  return {
    isBlocked: (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return true;
      return context.occupied[Math.floor(z) * world.cellsX + Math.floor(x)] === 1;
    },
    isStripReserved: signs.isStripReserved,
    validateGradedRoads: (planned: readonly RoadSegment[], existing: readonly RoadSegment[]) =>
      canLevelRoadGround(world, planned, existing, context.buildings)
  };
};
/** Same construction width, rock, foundation, signpost and grading rules as ordinary roads. */
export const createScenarioRoadNetwork = (context: SettlementContext) =>
  createRoadNetwork(context.options.world, constructionOptions(context));
const edgeKey = (a: RoadPoint, b: RoadPoint) => {
  const first = `${a.x},${a.z}`, last = `${b.x},${b.z}`;
  return first < last ? `${first}:${last}` : `${last}:${first}`;
};
/** Linear edge checks and one whole-network grading preview; no per-edge A* or quadratic rebuild. */
export const inspectScenarioRoads = (context: SettlementContext, segments: readonly RoadSegment[]) => {
  const { world } = context.options, options = constructionOptions(context);
  const traversal = createRoadTraversal(world, { ...options, getHeight: () => 0 }, ROAD_STONE_WIDTH);
  const edges = new Set(segments.map(segment => edgeKey(segment.start, segment.end)));
  const hasEdge = (a: RoadPoint, b: RoadPoint) => edges.has(edgeKey(a, b));
  const errors: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (!traversal.walkable(segment.start, segment.end) ||
      !isRoadVergeClear(segment.start, segment.end, options.isBlocked, traversal.validPoint) ||
      options.isStripReserved(segment.start, segment.end) ||
      roadIntersectsVisibleRock(world, segment.start, segment.end, ROAD_STONE_WIDTH) ||
      parallelRoadConflict(segment.start, segment.end, hasEdge))
      errors.push(`Road ${index + 1}: blocked reserved strip or parallel road overlap`);
  }
  if (segments.length && !canLevelRoadGround(world, segments, [], context.buildings))
    errors.push("Authored roads: the whole network cannot be graded safely");
  return errors;
};
