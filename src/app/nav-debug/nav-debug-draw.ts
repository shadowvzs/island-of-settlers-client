import type { ViewportPoint } from "../../render-common/iso-projection";
import type { AnimalManager } from "../../render-common/wildlife/animal-manager";
import { COLLIDER_KIND } from "../../render-common/wildlife/nav/nav-colliders";
import { MAX_PATH_POINTS } from "../../render-common/wildlife/nav/nav-path";
import type { NavWorld } from "../../render-common/wildlife/nav/nav-query";
import { NAV_CELL, NAV_FLAG, sampleNavHeight } from "../../render-common/wildlife/nav/nav-terrain";
import {
  ANIMAL_STATE_NAMES,
  getSpecies,
  SPECIES
} from "../../render-common/wildlife/wildlife-species";

export type Project = (x: number, y: number, z: number) => ViewportPoint;

/** World rectangle around the view centre that the debug view covers. */
export interface DebugArea {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

const COLLIDER_COLORS: Record<number, string> = {
  [COLLIDER_KIND.trunk]: "rgba(120, 60, 20, 0.9)",
  [COLLIDER_KIND.rock]: "rgba(90, 90, 110, 0.9)",
  [COLLIDER_KIND.shrub]: "rgba(40, 140, 60, 0.9)",
  [COLLIDER_KIND.crown]: "rgba(255, 255, 255, 0.22)"
};
const SPECIES_COLORS = ["#f4e3a1", "#f0a050", "#c05030"];

const projectGround = (nav: NavWorld, project: Project, x: number, z: number) =>
  project(x, sampleNavHeight(nav.terrain, x, z), z);

/**
 * Colour of a nav cell: water blue, rock / cliff red, too steep for everyone orange, walkable
 * by rabbits only yellow, by all species green.
 */
const getCellColor = (nav: NavWorld, cell: number) => {
  const flags = nav.terrain.flags[cell]!;
  if (flags & NAV_FLAG.water) return "rgba(40, 110, 255, 0.35)";
  if (flags & (NAV_FLAG.rock | NAV_FLAG.cliff | NAV_FLAG.border)) return "rgba(220, 40, 40, 0.4)";
  if (nav.species[SPECIES.elk]!.ground[cell]) return "rgba(60, 220, 90, 0.22)";
  if (nav.species[SPECIES.rabbit]!.ground[cell]) return "rgba(255, 220, 40, 0.35)";
  return "rgba(255, 130, 20, 0.4)";
};

/** The walkable mask (terrain part) as projected nav cell quads. */
export const drawWalkMask = (
  context: CanvasRenderingContext2D,
  nav: NavWorld,
  project: Project,
  area: DebugArea
) => {
  const { width } = nav.terrain;
  const first = (value: number) => Math.max(0, Math.floor(value / NAV_CELL));
  for (
    let row = first(area.minZ);
    row < Math.min(nav.terrain.depth, area.maxZ / NAV_CELL);
    row += 1
  ) {
    for (
      let column = first(area.minX);
      column < Math.min(width, area.maxX / NAV_CELL);
      column += 1
    ) {
      const x = column * NAV_CELL;
      const z = row * NAV_CELL;
      const corners = [
        projectGround(nav, project, x, z),
        projectGround(nav, project, x + NAV_CELL, z),
        projectGround(nav, project, x + NAV_CELL, z + NAV_CELL),
        projectGround(nav, project, x, z + NAV_CELL)
      ];
      context.fillStyle = getCellColor(nav, row * width + column);
      context.beginPath();
      corners.forEach((corner, index) =>
        index === 0 ? context.moveTo(corner.x, corner.y) : context.lineTo(corner.x, corner.y)
      );
      context.fill();
    }
  }
};

/** A ground circle: projected centre and a radius point (ellipse in the iso view). */
const drawGroundCircle = (
  context: CanvasRenderingContext2D,
  nav: NavWorld,
  project: Project,
  circle: { radius: number; x: number; z: number }
) => {
  const centre = projectGround(nav, project, circle.x, circle.z);
  const right = projectGround(nav, project, circle.x + circle.radius, circle.z - circle.radius);
  const radiusX = Math.max(1, Math.abs(right.x - centre.x));
  context.beginPath();
  context.ellipse(centre.x, centre.y, radiusX, radiusX * 0.5, 0, 0, Math.PI * 2);
  context.stroke();
};

export const drawColliders = (
  context: CanvasRenderingContext2D,
  nav: NavWorld,
  project: Project,
  area: DebugArea
) => {
  const { colliders } = nav;
  context.lineWidth = 1.5;
  for (let index = 0; index < colliders.count; index += 1) {
    const x = colliders.x[index]!;
    const z = colliders.z[index]!;
    if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) continue;
    context.strokeStyle = COLLIDER_COLORS[colliders.kind[index]!]!;
    drawGroundCircle(context, nav, project, { radius: colliders.radius[index]!, x, z });
  }
};

const drawPath = (
  context: CanvasRenderingContext2D,
  manager: AnimalManager,
  project: Project,
  animal: number
) => {
  const { nav, pool } = manager.debug;
  const start = projectGround(nav, project, pool.x[animal]!, pool.z[animal]!);
  context.beginPath();
  context.moveTo(start.x, start.y);
  for (let point = pool.pathIndex[animal]!; point < pool.pathCount[animal]!; point += 1) {
    const offset = (animal * MAX_PATH_POINTS + point) * 2;
    const next = projectGround(nav, project, pool.path[offset]!, pool.path[offset + 1]!);
    context.lineTo(next.x, next.y);
  }
  context.stroke();
  const target = projectGround(nav, project, pool.targetX[animal]!, pool.targetZ[animal]!);
  context.strokeRect(target.x - 3, target.y - 3, 6, 6);
};

const drawThreat = (
  context: CanvasRenderingContext2D,
  manager: AnimalManager,
  project: Project,
  animal: number
) => {
  const { nav, pool } = manager.debug;
  if (pool.threatAge[animal]! > 6) return;
  const threat = projectGround(nav, project, pool.threatX[animal]!, pool.threatZ[animal]!);
  context.strokeStyle = "#ff2020";
  context.beginPath();
  context.moveTo(threat.x - 6, threat.y - 6);
  context.lineTo(threat.x + 6, threat.y + 6);
  context.moveTo(threat.x + 6, threat.y - 6);
  context.lineTo(threat.x - 6, threat.y + 6);
  context.stroke();
};

/** Per living animal: clearance, route and target, velocity, state, threat source. */
export const drawAnimals = (
  context: CanvasRenderingContext2D,
  manager: AnimalManager,
  project: Project
) => {
  const { nav, pool } = manager.debug;
  context.font = "11px system-ui, sans-serif";
  for (let animal = 0; animal < pool.active.length; animal += 1) {
    if (!pool.active[animal] || pool.pending[animal]) continue;
    const species = pool.species[animal]!;
    const x = pool.x[animal]!;
    const z = pool.z[animal]!;
    context.strokeStyle = SPECIES_COLORS[species]!;
    context.lineWidth = 2;
    drawGroundCircle(context, nav, project, { radius: getSpecies(species).clearance, x, z });
    context.lineWidth = 1;
    drawPath(context, manager, project, animal);
    const tip = projectGround(
      nav,
      project,
      x + pool.velocityX[animal]!,
      z + pool.velocityZ[animal]!
    );
    const base = projectGround(nav, project, x, z);
    context.strokeStyle = "#ffffff";
    context.beginPath();
    context.moveTo(base.x, base.y);
    context.lineTo(tip.x, tip.y);
    context.stroke();
    drawThreat(context, manager, project, animal);
    context.fillStyle = "#ffffff";
    context.fillText(ANIMAL_STATE_NAMES[pool.state[animal]!]!, base.x + 6, base.y - 6);
  }
};
