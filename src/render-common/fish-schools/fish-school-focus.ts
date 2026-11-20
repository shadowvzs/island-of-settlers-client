import { createViewRegion, isInView, updateViewRegion } from "../birds/bird-view";
import type { CameraState } from "../camera-state";
import type { ShipFrame, ShuttleBoatFrame } from "../ships/ship-frame";
import type { FishFocus, FishSchools } from "./fish-school-sim";

/** Iso views wider than this (half width, world units) show the fish under a few pixels: none. */
const FAR_HALF_WIDTH = 34;
const VIEW_MARGIN = 3;
/** Possessed view: homes within this distance of the eye. */
const EYE_REACH = 26;
/** Flee reach (world units) of a sailing ship's hull, a rowing boat and a person. */
const SHIP_REACH = 4.2;
const BOAT_REACH = 2.4;
const PERSON_REACH = 1.5;

/** The point the possessed camera stands at, if the view is possessed. */
export interface FishEye {
  x: number;
  z: number;
}

/**
 * The fish's view of the frame: the homes around the iso view or the possessed eye, and the
 * threats (ships, boats, people, the possessed walker) near the active schools.
 */
export const createFishSchoolFocus = () => {
  const region = createViewRegion();
  let eye: FishEye | null = null;
  let farView = false;
  const focus: FishFocus = {
    centerX: 0,
    centerZ: 0,
    contains: (x, z) => {
      if (eye) return Math.hypot(x - eye.x, z - eye.z) <= EYE_REACH;
      return !farView && isInView(region, x, 0, z, VIEW_MARGIN);
    }
  };

  const update = (camera: CameraState, possessedEye: FishEye | null) => {
    eye = possessedEye;
    updateViewRegion(region, camera);
    farView = region.halfU > FAR_HALF_WIDTH;
    focus.centerX = possessedEye ? possessedEye.x : region.centerX;
    focus.centerZ = possessedEye ? possessedEye.z : region.centerZ;
    return focus;
  };

  return { update };
};

/** Every hull, boat and person of the frame as a threat (the schools keep only nearby ones). */
export const addFrameThreats = (
  schools: FishSchools,
  frame: {
    ships?: readonly ShipFrame[];
    shuttleBoats?: readonly ShuttleBoatFrame[];
    workers?: readonly { visible?: boolean; x: number; z: number }[];
  },
  eye: FishEye | null
) => {
  schools.beginThreats();
  for (const ship of frame.ships ?? []) if (ship.phase !== "away") schools.addThreat(ship.x, ship.z, SHIP_REACH);
  for (const boat of frame.shuttleBoats ?? []) schools.addThreat(boat.x, boat.z, BOAT_REACH);
  for (const worker of frame.workers ?? []) {
    if (worker.visible !== false) schools.addThreat(worker.x, worker.z, PERSON_REACH);
  }
  if (eye) schools.addThreat(eye.x, eye.z, PERSON_REACH);
};
