import {
  excludeRoadFieldCover,
  isBridgeCoverExcluded,
  isRoadCoverExcluded
} from "../../render-common/props/field-cover-exclusions";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { navigationPropRadius } from "../../shared/settlement/navigation-prop-geometry";
import type { RoadSegment } from "../../shared/settlement/road-types";
import { overlapsSettlementGround } from "../../shared/settlement/settlement-ground-clearance";
import { removePropsAt } from "../../shared/world/editing/prop-removal";
import { bumpBuildRevision } from "../../shared/world/save/world-change-journal";
import { PROP, type WorldData } from "../../shared/world/world-data";

const roadsidePlants = new Set<number>([
  PROP.largeRock, PROP.smallRock, PROP.bush, PROP.flowers, PROP.mushrooms, PROP.fern, PROP.sedge,
  PROP.berryBush, PROP.fieldShrub, PROP.broadleafShrub, PROP.riverShrub, PROP.willowShrub
]);

/** Reeds, cattails and lilies wade at the water's edge: only a bridge (deck, abutments, ramps) clears them. */
const bridgeOnlyPlants = new Set<number>([PROP.reeds, PROP.cattail, PROP.waterLily]);

const clearedByGround = (world: WorldData, index: number, x: number, z: number) => {
  const type = world.props.types[index]!;
  if (bridgeOnlyPlants.has(type)) return isBridgeCoverExcluded(world, x, z);
  if (!roadsidePlants.has(type)) return false;
  const rock = type === PROP.largeRock || type === PROP.smallRock;
  const radius = rock ? navigationPropRadius(world, index) : 0;
  return isRoadCoverExcluded(world, x, z) || (rock &&
    overlapsSettlementGround(world, x - radius, z - radius, x + radius, z + radius));
};

/**
 * Clear rooted decorative plants as well as procedural grass; roads never remove trees or animals.
 * `bridgeSites` are the deck orders of bridges under construction: their footprint is cleared too.
 */
export const clearIslandRoadGround = (
  world: WorldData,
  renderer: Pick<TerrainRenderer, "mapEdit">,
  roads: readonly RoadSegment[],
  bridgeSites: readonly RoadSegment[] = []
) => {
  const segments = bridgeSites.length ? [...roads, ...bridgeSites] : roads;
  if (renderer.mapEdit?.reserveRoadGround) renderer.mapEdit.reserveRoadGround(segments);
  else excludeRoadFieldCover(world, segments);
  const removed: number[] = [];
  for (let index = 0; index < world.props.count; index++) {
    const x = world.props.x[index]!, z = world.props.z[index]!;
    if (clearedByGround(world, index, x, z)) removed.push(index);
  }
  renderer.mapEdit?.refreshRockClearance?.();
  if (!removed.length) return;
  const xs = removed.map((index) => world.props.x[index]!);
  const zs = removed.map((index) => world.props.z[index]!);
  removePropsAt(world, removed);
  renderer.mapEdit?.removeProps(removed, {
    minX: Math.floor(Math.min(...xs)), maxX: Math.floor(Math.max(...xs)),
    minZ: Math.floor(Math.min(...zs)), maxZ: Math.floor(Math.max(...zs))
  });
  bumpBuildRevision(world, null);
};
