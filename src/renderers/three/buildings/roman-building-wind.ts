import type { BuildingFrame } from "../../../render-common/buildings/building-catalog";
import type { EnvironmentState } from "../../../render-common/environment";

/** Reused state: rendering never changes authoritative caller frames. */
export const createRomanBuildingWindState = (): BuildingFrame => ({
  id: "", type: 0, x: 0, y: 0, z: 0, rotation: 0,
  construction: 0, working: false, door: 0
});

export const updateRomanBuildingWindState = (
  state: BuildingFrame,
  frame: BuildingFrame,
  environment: Pick<EnvironmentState, "windX" | "windZ">
) => {
  state.construction = frame.construction;
  state.working = frame.working;
  state.workTime = frame.workTime;
  state.catapultCycle = frame.catapultCycle;
  state.catapultAim = frame.catapultAim;
  state.catapultSupply = frame.catapultSupply;
  state.catapultGroundPoints = frame.catapultGroundPoints;
  state.catapultRackKinds = frame.catapultRackKinds;
  state.x = frame.x; state.y = frame.y; state.z = frame.z; state.rotation = frame.rotation;
  state.workRate = frame.workRate;
  state.wellBucketTaken = frame.wellBucketTaken;
  state.door = frame.door;
  state.doorLeaves = frame.doorLeaves;
  state.balconyDoor = frame.balconyDoor;
  state.playerColor = frame.playerColor;
  state.inputStock = frame.inputStock;
  state.outputStock = frame.outputStock;
  state.windStrength = Math.hypot(environment.windX, environment.windZ);
  // Three's positive Y rotation sends +X towards -Z. Cancel the building rotation.
  state.windDirection = Math.atan2(-environment.windZ, environment.windX) - frame.rotation;
  return state;
};

/** Stable spatial phase avoids synchronized cloth without affecting production animation time. */
export const romanBuildingFlagPhase = (frame: Pick<BuildingFrame, "x" | "z">) =>
  frame.x * 1.13 + frame.z * 0.73;
