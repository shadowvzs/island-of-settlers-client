import { getRomanBuildingWorldSizing } from "../buildings/building-world-sizing";
import type { BuildingLevel } from "../buildings/levels/building-level";
import type { WorkerNation } from "../workers/worker-unit";
import type { BirdPosition } from "./bird-building-avoidance";
import {
  type BirdBuilding,
  birdBuildingLevel,
  birdBuildingNation,
  birdModelKey,
  getBirdBuildingModel
} from "./bird-building-models";
import { findRoofRidgeSpan } from "./bird-roof-ridge";

/** Only the owner's architecture may be ignored, and only above its highest solid roof. */
export interface BirdRoofPerch {
  uid: number;
  x: number;
  y: number;
  z: number;
  surfaceY: number;
  heading: number;
  spacing: number;
}
interface RoofTemplate {
  x: number;
  y: number;
  z: number;
  /** Direction of the ridge in the unrotated building (π/2 along z, 0 along x). */
  heading: number;
  length: number;
}
const templates = new Map<number, RoofTemplate | null>();

const createTemplate = (typeId: number, nation: WorkerNation, level: BuildingLevel): RoofTemplate | null => {
  const { definition, recipes } = getBirdBuildingModel(typeId, nation, level);
  const sizing = getRomanBuildingWorldSizing(definition);
  // Animated rotors/cranes, flags and roof furniture are never used as perches.
  if (sizing.overhead.length || definition.mechanism !== "none") return null;
  if (recipes.some((recipe) => recipe.flagAnchor)) return null;
  const span = findRoofRidgeSpan(recipes);
  if (!span) return null;
  return {
    x: span.centre[0] * sizing.scale,
    y: span.centre[1] * sizing.scale,
    z: span.centre[2] * sizing.scale,
    heading: span.axis === 2 ? Math.PI / 2 : 0,
    length: span.length * sizing.scale
  };
};

/** The ridge of the building's current level in the settlement's nation (cached, never per frame). */
const templateFor = (building: BirdBuilding) => {
  const level = birdBuildingLevel(building),
    nation = birdBuildingNation(building),
    key = birdModelKey(building.typeId, nation, level);
  if (!templates.has(key)) templates.set(key, createTemplate(building.typeId, nation, level));
  return templates.get(key)!;
};

export const getBirdRoofPerch = (
  building: BirdBuilding,
  size: number,
  count: number
): BirdRoofPerch | null => {
  if ((building.construction ?? 1) < 1) return null;
  const roof = templateFor(building);
  const spacing = size * 0.65;
  if (!roof || (count - 1) * spacing + size * 1.2 > roof.length) return null;
  const yaw = (building.rotation * Math.PI) / 2,
    cos = Math.cos(yaw),
    sin = Math.sin(yaw);
  const surfaceY = building.y + roof.y;
  return {
    uid: building.uid,
    x: building.x + roof.x * cos + roof.z * sin,
    y: surfaceY + size * 0.12,
    z: building.z - roof.x * sin + roof.z * cos,
    surfaceY,
    heading: roof.heading - yaw,
    spacing
  };
};

export const getRoofSlot = (
  roof: BirdRoofPerch,
  member: number,
  count: number,
  out = { x: 0, y: 0, z: 0 }
) => {
  const offset = (member - (count - 1) / 2) * roof.spacing;
  out.x = roof.x + Math.cos(roof.heading) * offset;
  out.y = roof.y;
  out.z = roof.z + Math.sin(roof.heading) * offset;
  return out;
};

/** Ridge reservations are independent of the broad-phase flight bins. */
export const createRoofReservations = (
  buildings: () => readonly BirdBuilding[],
  clear: (point: BirdPosition, radius: number, roof?: BirdRoofPerch | null) => boolean,
  hit: (
    from: BirdPosition,
    to: BirdPosition,
    radius: number,
    roof?: BirdRoofPerch | null
  ) => unknown
) => {
  const roofOwners = new Map<number, object>();
  const validRoof = (roof: BirdRoofPerch, size: number, count: number) => {
    const building = buildings().find((building) => building.uid === roof.uid);
    const current = building && getBirdRoofPerch(building, size, count);
    return (
      !!current &&
      Math.abs(current.x - roof.x) < 1e-6 &&
      Math.abs(current.y - roof.y) < 1e-6 &&
      Math.abs(current.z - roof.z) < 1e-6 &&
      current.heading === roof.heading
    );
  };
  const roofNear = (point: BirdPosition, size: number, count: number) => {
    let best: BirdRoofPerch | null = null,
      distance = 12;
    for (const building of buildings()) {
      const roof = getBirdRoofPerch(building, size, count);
      if (
        !roof ||
        (roofOwners.has(roof.uid) && roofOwners.get(roof.uid) !== point) ||
        point.y < roof.y ||
        !clear(roof, size * 0.6, roof)
      )
        continue;
      const range = Math.hypot(roof.x - point.x, roof.z - point.z);
      if (range < 2 || range > distance) continue;
      if (hit(point, { x: roof.x, y: point.y, z: roof.z }, size * 0.6, roof)) continue;
      distance = range;
      best = roof;
    }
    if (best) roofOwners.set(best.uid, point);
    return best;
  };
  const releaseRoof = (owner: object) => {
    for (const [uid, current] of roofOwners) if (current === owner) roofOwners.delete(uid);
  };
  return { validRoof, roofNear, releaseRoof };
};
