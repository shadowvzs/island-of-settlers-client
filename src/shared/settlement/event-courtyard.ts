import { banditSiteKey } from "../../render-common/buildings/bandit-camp-plan";
import { createBanditCampRecipe } from "../../render-common/buildings/bandit-camp-recipe";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import type { SettlementSoldier } from "./settlement-military";
import { isNavigationClear } from "./settlement-navigation";
import { bumpNavigationRevision } from "./settlement-reservations";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

interface CourtyardWall {
  hp: number;
  maximum: number;
}
/** North, east, south, west, in the building's local coordinates. Event sites only. */
export interface EventCourtyard {
  walls: CourtyardWall[];
}

const localPoint = (site: SettlementBuilding, point: SettlementPoint) => {
  const angle = (site.rotation * Math.PI) / 2,
    dx = point.x - site.x,
    dz = point.z - site.z;
  return {
    x: dx * DMath.cos(angle) - dz * DMath.sin(angle),
    z: dx * DMath.sin(angle) + dz * DMath.cos(angle)
  };
};
const worldPoint = (site: SettlementBuilding, x: number, z: number) => {
  const angle = (site.rotation * Math.PI) / 2;
  return {
    x: site.x + x * DMath.cos(angle) + z * DMath.sin(angle),
    z: site.z - x * DMath.sin(angle) + z * DMath.cos(angle)
  };
};
const localSize = (site: SettlementBuilding): [number, number] =>
  site.rotation % 2 ? [site.depth, site.width] : [site.width, site.depth];
const insideCourtyard = (site: SettlementBuilding, point: SettlementPoint) => {
  const local = localPoint(site, point),
    [width, depth] = localSize(site);
  return Math.abs(local.x) < width / 2 - 0.5 && Math.abs(local.z) < depth / 2 - 0.5;
};
export const courtyardWallAt = (site: SettlementBuilding, point: SettlementPoint) => {
  const local = localPoint(site, point),
    [width, depth] = localSize(site);
  if (Math.abs(local.x) / width > Math.abs(local.z) / depth) return local.x > 0 ? 1 : 3;
  return local.z > 0 ? 2 : 0;
};
const shelterCache = new Map<string, ReturnType<typeof createBanditCampRecipe>["parts"]>();
const tents = (site: SettlementBuilding) => {
  const key = banditSiteKey(site.bandit!);
  let shelters = shelterCache.get(key);
  if (!shelters) {
    shelters = createBanditCampRecipe(
      site.bandit!,
      { bandit: site.bandit, theme: "forest" },
      false
    ).parts.filter((part) => part.campDecoration === "tent");
    shelterCache.set(key, shelters);
  }
  return shelters;
};

/** Real perimeter and tent cells, leaving courtyard ground traversable after a breach. */
export const refreshCourtyardOccupancy = (context: SettlementContext, site: SettlementBuilding) => {
  if (!site.eventCourtyard) return;
  const [width, depth] = localSize(site),
    shelters = tents(site);
  for (let z = site.z - site.depth / 2; z < site.z + site.depth / 2; z++)
    for (let x = site.x - site.width / 2; x < site.x + site.width / 2; x++) {
      const point = localPoint(site, { x: x + 0.5, z: z + 0.5 });
      const wall =
        (point.z <= -depth / 2 + 0.5 && site.eventCourtyard.walls[0]!.hp > 0) ||
        (point.x >= width / 2 - 0.5 && site.eventCourtyard.walls[1]!.hp > 0) ||
        (point.z >= depth / 2 - 0.5 && site.eventCourtyard.walls[2]!.hp > 0) ||
        (point.x <= -width / 2 + 0.5 && site.eventCourtyard.walls[3]!.hp > 0);
      const shelter = shelters.some(
        (part) =>
          Math.abs(point.x - part.position[0]) < part.size[0] / 2 + 0.2 &&
          Math.abs(point.z - part.position[2]) < part.size[2] / 2 + 0.2
      );
      context.occupied[z * context.options.world.cellsX + x] = Number(wall || shelter);
    }
  bumpNavigationRevision(context);
  bumpBuildRevision(context.options.world, null);
};

/** Once a wall is open, attackers can walk to and assault the actual central shelter. */
export const courtyardAssaultSite = (site: SettlementBuilding, point: SettlementPoint) => {
  if (
    !site.eventCourtyard ||
    (!insideCourtyard(site, point) &&
      site.eventCourtyard.walls[courtyardWallAt(site, point)]!.hp > 0)
  )
    return site;
  const shelter = tents(site)[0];
  if (!shelter) return site;
  const centre = worldPoint(site, shelter.position[0], shelter.position[2]);
  return {
    ...site,
    ...centre,
    width: shelter.size[site.rotation % 2 ? 2 : 0],
    depth: shelter.size[site.rotation % 2 ? 0 : 2]
  };
};

export const releaseCourtyardDefenders = (
  context: SettlementContext,
  site: SettlementBuilding,
  soldiers: Map<number, SettlementSoldier>,
  actorById: (id: number) => SettlementActor | undefined
) => {
  if (!site.eventCourtyard?.walls.some((wall) => wall.hp <= 0)) return;
  const guards = [...soldiers.values()].filter(
    (soldier) =>
      soldier.stationed &&
      soldier.building === site.uid &&
      soldier.combat &&
      soldier.combat.type !== "archer"
  );
  if (!guards.length) return;
  const candidates: SettlementPoint[] = [];
  for (let z = site.z - site.depth / 2 + 1.5; z < site.z + site.depth / 2 - 1; z++)
    for (let x = site.x - site.width / 2 + 1.5; x < site.x + site.width / 2 - 1; x++)
      candidates.push({ x, z });
  for (let ring = 1; ring <= 4; ring++)
    for (let step = 0; step < 16; step++)
      candidates.push({
        x: site.access.x + DMath.cos((step * Math.PI) / 8) * ring * 0.8,
        z: site.access.z + DMath.sin((step * Math.PI) / 8) * ring * 0.8
      });
  for (const soldier of guards) {
    const body = actorById(soldier.actor);
    const point = candidates.find(
      (point) =>
        isNavigationClear(context, point) &&
        !context.actors.some(
          (other) => other.visible && DMath.hypot(other.x - point.x, other.z - point.z) < 0.65
        )
    );
    if (!body || !point) continue;
    soldier.stationed = false;
    soldier.building = -3;
    const state = soldier.combat!;
    state.siege = undefined;
    state.destination = undefined;
    state.target = undefined;
    state.attackTime = 0;
    state.cooldown = 0.5;
    state.marchSpeed = undefined;
    Object.assign(body, point, {
      y: sampleSmooth(context.options.world, context.options.world.heights, point.x, point.z),
      building: body.home,
      phase: "militaryField",
      visible: true,
      action: "idle",
      path: [],
      pathIndex: 0
    });
  }
};

export const strikeCourtyardWall = (
  context: SettlementContext,
  site: SettlementBuilding,
  point: SettlementPoint,
  amount: number
) => {
  if (insideCourtyard(site, point)) return false;
  const wall = site.eventCourtyard?.walls[courtyardWallAt(site, point)];
  if (!wall || wall.hp <= 0) return false;
  wall.hp = Math.max(0, wall.hp - amount);
  if (!wall.hp) refreshCourtyardOccupancy(context, site);
  return true;
};

/** Open courtyard air and breached walls no longer act like a solid building for arrows. */
type ProjectileWall = {
  x: number;
  y: number;
  z: number;
  uid: number;
  width: number;
  depth: number;
};
const projectileCache = new WeakMap<
  SettlementBuilding,
  { mask: number; rectangles: ProjectileWall[] }
>();
export const courtyardProjectileWalls = (site: SettlementBuilding) => {
  const mask =
    site.eventCourtyard?.walls.reduce(
      (mask, wall, side) => mask | (wall.hp > 0 ? 1 << side : 0),
      0
    ) ?? 0;
  const cached = projectileCache.get(site);
  if (cached?.mask === mask) return cached.rectangles;
  const [width, depth] = localSize(site);
  const rectangles = [
    { x: 0, z: -depth / 2 + 0.17, width: width - 0.34, depth: 0.13 },
    { x: width / 2 - 0.17, z: 0, width: 0.13, depth: depth - 0.34 },
    { x: 0, z: depth / 2 - 0.17, width: width - 0.34, depth: 0.13 },
    { x: -width / 2 + 0.17, z: 0, width: 0.13, depth: depth - 0.34 }
  ].filter((_wall, side) => (site.eventCourtyard?.walls[side]?.hp ?? 0) > 0);
  rectangles.push(
    ...tents(site).map((part) => ({
      x: part.position[0],
      z: part.position[2],
      width: part.size[0],
      depth: part.size[2]
    }))
  );
  const result = rectangles.map((rect) => ({
    ...worldPoint(site, rect.x, rect.z),
    y: site.y,
    uid: site.uid,
    width: site.rotation % 2 ? rect.depth : rect.width,
    depth: site.rotation % 2 ? rect.width : rect.depth
  }));
  projectileCache.set(site, { mask, rectangles: result });
  return result;
};
