import { DMath } from "../../shared/math/deterministic-math";
import type { WorkerNation } from "../workers/worker-nation";

/**
 * FISHER-POLISH yard skiff (owner 2026-11-11): a delivered boat waiting at its Fishery leans on its side
 * against a bare wall, keel to the wall. Fishery-local world units (+z is the door front, scale applied),
 * measured from each nation's level 1–5 recipe:
 * - back wall (gable end, no door, no stock, net rack only on the right side) for most nations;
 * - Persian: the back wall also holds a small window, its sill .84 high: the boat (top ≈ .6) stays below it;
 * - Nubian: decorative vases stand along the back wall, so the boat leans on the left wall under its
 *   window (sill .65), clear of the front door.
 */
interface YardWall {
  /** Centre of the boat along the wall (x on the back wall, z on the left wall). */
  along: number;
  /** Outer plane of the wall, columns and frames included (negative: behind / left of the centre). */
  plane: number;
  wall: "back" | "left";
}

const YARD_WALLS: Readonly<Record<WorkerNation, YardWall>> = {
  chinese: { along: -.5, plane: -1.22, wall: "back" },
  indigenous: { along: -.5, plane: -1.23, wall: "back" },
  japanese: { along: -.5, plane: -1.24, wall: "back" },
  maya: { along: -.5, plane: -1.2, wall: "back" },
  nubian: { along: -.25, plane: -1.55, wall: "left" },
  persian: { along: -.5, plane: -1.35, wall: "back" },
  roman: { along: -.5, plane: -1.3, wall: "back" },
  viking: { along: -.5, plane: -1.26, wall: "back" }
};

export interface YardSkiffAnchor {
  x: number;
  z: number;
  /** Heading of the wall's outward normal (the skiff's open side faces it). */
  yaw: number;
}

/** The yard skiff's foot on the wall plane and outward heading, for a placed Fishery. */
export const fisheryYardSkiffAnchor = (
  nation: WorkerNation, building: { rotation: number; x: number; z: number }
): YardSkiffAnchor => {
  const { along, plane, wall } = YARD_WALLS[nation];
  const local = wall === "back" ? { x: along, z: plane } : { x: plane, z: along };
  const outward = wall === "back" ? { x: 0, z: -1 } : { x: -1, z: 0 };
  const angle = building.rotation * Math.PI / 2, cosine = DMath.cos(angle), sine = DMath.sin(angle);
  const turn = (point: { x: number; z: number }) =>
    ({ x: point.x * cosine + point.z * sine, z: -point.x * sine + point.z * cosine });
  const offset = turn(local), normal = turn(outward);
  return { x: building.x + offset.x, yaw: DMath.atan2(normal.x, normal.z), z: building.z + offset.z };
};


/** Stand outside the stored hull, aligned along the wall, ready to hoist it. */
export const fisheryYardSkiffPickup = (
  nation: WorkerNation, building: { rotation: number; x: number; z: number }
): YardSkiffAnchor => {
  const anchor = fisheryYardSkiffAnchor(nation, building), yaw = anchor.yaw + Math.PI / 2;
  return { x: anchor.x + DMath.sin(anchor.yaw) * .725 - DMath.sin(yaw) * .1,
    z: anchor.z + DMath.cos(anchor.yaw) * .725 - DMath.cos(yaw) * .1, yaw };
};

/** Reach the near gunwale from beside a grounded hull, facing across its beam. */
export const groundSkiffPickup = (boat: { x: number; z: number; yaw: number }): YardSkiffAnchor => {
  const yaw = boat.yaw - Math.PI / 2;
  return { x: boat.x - DMath.sin(yaw) * .6, z: boat.z - DMath.cos(yaw) * .6, yaw };
};
