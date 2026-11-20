import {
  adventureCampDecorations,   type AdventureCampFrame, CAMP_ASSEMBLY_RADIUS,
type CampDecoration,
campDecorationClearsAssemblies} from "../../render-common/adventure/adventure-camp";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import type { WorldData } from "../world/world-data";
import { CAMP_MOUNTED_CLEARANCE, campDecorationObstacle, type CampObstacle,campObstacleDistance } from "./adventure-camp-obstacles";
import { campObstaclePreservesPassages } from "./adventure-camp-placement-safety";

export interface AcceptedCampLayout { camps: ReadonlyMap<number, readonly CampDecoration[]>; obstacles: readonly CampObstacle[] }
const cache = new WeakMap<WorldData, { key: string; layout: AcceptedCampLayout }>();
// Clustered camps share their edges. Try the complete perimeter so their tents can face
// outwards instead of disappearing when the original side meets a neighbouring group.
const DECORATION_ANGLES = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2,
  Math.PI * .75, -Math.PI * .75, Math.PI];
const decorationFitsGround = (world: WorldData, camp: AdventureCampFrame, decoration: CampDecoration) => {
  let lowest = Infinity, highest = -Infinity;
  for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    const x = camp.x + decoration.x + dx * decoration.radius, z = camp.z + decoration.z + dz * decoration.radius;
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
    const cell = Math.floor(z) * world.cellsX + Math.floor(x);
    if (!world.walkCost[cell] || world.blocking[cell]) return false;
    const height = sampleSmooth(world, world.heights, x, z);
    if (height < world.seaLevel + .08) return false;
    lowest = Math.min(lowest, height); highest = Math.max(highest, height);
  }
  return highest - lowest < .6;
};
/** Renderer and physics consume this identical list. Base ground never includes its own overlay. */
export const acceptedAdventureCampLayout = (world: WorldData, frames: readonly AdventureCampFrame[]): AcceptedCampLayout => {
  const camps = frames.slice(0, 6);
  const plots = camps[0]?.defencePlots ?? [];
  const key = `${world.terrainRevision ?? 0}:${world.buildRevision ?? 0}:${world.props.count}:` +
    camps.map(camp => `${camp.id}:${camp.x}:${camp.z}:${camp.theme ?? "bandit"}`).join(";") +
    plots.map(plot => `:${plot.x},${plot.z},${plot.width},${plot.depth}`).join("");
  const known = cache.get(world);
  if (known?.key === key) return known.layout;
  const fixedObstacles: CampObstacle[] = plots.map(plot => ({ ...plot,
    campId: -1, kind: "tent", cosine: 1, sine: 0, halfX: plot.width / 2, halfZ: plot.depth / 2 }));
  const obstacles: CampObstacle[] = [], layouts = new Map<number, readonly CampDecoration[]>();
  const occupiedDecorations: { x: number; z: number; radius: number }[] = [];
  for (const camp of camps) {
    const placed: CampDecoration[] = [];
    for (const design of adventureCampDecorations()) {
      for (const angle of DECORATION_ANGLES) {
        const decoration = { ...design, x: design.x * DMath.cos(angle) + design.z * DMath.sin(angle),
          z: -design.x * DMath.sin(angle) + design.z * DMath.cos(angle), yaw: design.yaw + angle };
        if (plots.some(plot => Math.abs(camp.x + decoration.x - plot.x) < plot.width / 2 + decoration.radius + .3 &&
          Math.abs(camp.z + decoration.z - plot.z) < plot.depth / 2 + decoration.radius + .3)) continue;
        if (!campDecorationClearsAssemblies(camp, decoration, camps) || !decorationFitsGround(world, camp, decoration) ||
          occupiedDecorations.some(other => DMath.hypot(other.x - camp.x - decoration.x,
            other.z - camp.z - decoration.z) <= other.radius + decoration.radius + .25)) continue;
        const obstacle = campDecorationObstacle(camp, decoration);
        if (obstacle && (camps.some(other => campObstacleDistance(obstacle, other) < CAMP_ASSEMBLY_RADIUS + CAMP_MOUNTED_CLEARANCE) ||
          !campObstaclePreservesPassages(world, [...fixedObstacles, ...obstacles], obstacle))) continue;
        placed.push(decoration);
        occupiedDecorations.push({ x: camp.x + decoration.x, z: camp.z + decoration.z, radius: decoration.radius });
        if (obstacle) obstacles.push(obstacle);
        break;
      }
    }
    layouts.set(camp.id, placed);
  }
  const layout = { camps: layouts, obstacles }; cache.set(world, { key, layout }); return layout;
};
export const adventureCampLayout = (world: WorldData, camp: AdventureCampFrame, camps: readonly AdventureCampFrame[]) =>
  acceptedAdventureCampLayout(world, camps).camps.get(camp.id) ?? [];
