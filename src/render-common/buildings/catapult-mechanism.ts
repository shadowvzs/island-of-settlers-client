import { CATAPULT_DECK_HEIGHT, catapultRoofHeight } from "./catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "./catapult-hatch";
/** Shared physical recipe data for the compact engine and its real hand contacts. */
export const CATAPULT_ENGINE_SCALE = .78;
/** Owner revision: 15% smaller than the verified .40-world baseline; all ammunition states share it. */
export const CATAPULT_STONE_DIAMETER = .23375;
/** Measured seating allowance for the fractured rock against the unchanged shallow scoop walls. */
export const CATAPULT_STONE_SEAT_LIFT = .012;
export const CATAPULT_ENGINE_ORIGIN = [.17, CATAPULT_DECK_HEIGHT, .09] as const;
export const CATAPULT_ENGINE_LIFT = .063;
export const CATAPULT_HATCH = { position: CATAPULT_HATCH_WELL.center, size: CATAPULT_HATCH_WELL.top,
  hinge: [CATAPULT_HATCH_WELL.center[0] - CATAPULT_HATCH_WELL.lower / 2 - .0175, CATAPULT_DECK_HEIGHT, CATAPULT_HATCH_WELL.center[2]] as const };
export const catapultStationPoint = (point: readonly number[]): [number, number, number] =>
  [CATAPULT_ENGINE_ORIGIN[0] + point[0]!, catapultRoofHeight(point[1]!), CATAPULT_ENGINE_ORIGIN[2] + point[2]!];
export const catapultMechanismPoint = (point: readonly number[]): [number, number, number] =>
  [CATAPULT_ENGINE_ORIGIN[0] + point[0]! * CATAPULT_ENGINE_SCALE, CATAPULT_DECK_HEIGHT + (point[1]! - 1.77) * CATAPULT_ENGINE_SCALE + CATAPULT_ENGINE_LIFT,
    CATAPULT_ENGINE_ORIGIN[2] + point[2]! * CATAPULT_ENGINE_SCALE];
export const CATAPULT_SCOOP = Object.freeze({
  innerFloor: -.22,
  pitch: .58 - Math.PI / 2,
  position: catapultMechanismPoint([0, 2.92, .42]),
  size: [.36, .14, .40] as const
});
const armPitch = .58, armDirection = [0, Math.cos(armPitch), Math.sin(armPitch)] as const;
const originalArm = catapultMechanismPoint([0, 2.39, .08]);
const originalLength = 1.24 * CATAPULT_ENGINE_SCALE;
const tipBeyondCupRear = (originalArm[1] + armDirection[1] * originalLength / 2 - CATAPULT_SCOOP.position[1]) * armDirection[1]
  + (originalArm[2] + armDirection[2] * originalLength / 2 - CATAPULT_SCOOP.position[2]) * armDirection[2]
  + CATAPULT_SCOOP.size[2] / 2;
/** Stop at the rear exterior; a separate underside socket supports the hollow scoop. */
export const CATAPULT_ARM = Object.freeze({
  pitch: armPitch,
  position: [CATAPULT_ENGINE_ORIGIN[0], originalArm[1] - armDirection[1] * tipBeyondCupRear / 2,
    originalArm[2] - armDirection[2] * tipBeyondCupRear / 2] as const,
  size: [.13 * CATAPULT_ENGINE_SCALE, originalLength - tipBeyondCupRear, .15 * CATAPULT_ENGINE_SCALE] as const
});
export const CATAPULT_SCOOP_SOCKET = Object.freeze({
  position: [CATAPULT_ENGINE_ORIGIN[0], CATAPULT_SCOOP.position[1] - Math.cos(CATAPULT_SCOOP.pitch) * .08 - armDirection[1] * .10,
    CATAPULT_SCOOP.position[2] - Math.sin(CATAPULT_SCOOP.pitch) * .08 - armDirection[2] * .10] as const,
  size: [.13, .04, .27] as const
});
export const CATAPULT_CRANK = Object.freeze({
  gripX: CATAPULT_ENGINE_ORIGIN[0] - .56, halfSpanZ: .06, pivot: catapultStationPoint([-.50, 2.20, .10]), radius: .09
});
const traverseBody = catapultStationPoint([.18, 1.77, -.466]);
const traverseRadius = Math.hypot(.18, -.466), tangentX = -.466 / traverseRadius, tangentZ = -.18 / traverseRadius;
const grip = [traverseBody[0] + tangentX * .15, catapultRoofHeight(2.24), traverseBody[2] + tangentZ * .15] as const;
export const CATAPULT_TRAVERSE = Object.freeze({
  body: traverseBody, facing: Math.atan2(tangentX, tangentZ),
  hands: [[grip[0] + tangentZ * .05, grip[1], grip[2] - tangentX * .05],
    [grip[0] - tangentZ * .05, grip[1], grip[2] + tangentX * .05]] as const,
  trigger: [grip[0] - tangentZ * .05 - .015, grip[1] - .01, grip[2] + tangentX * .05 + .02] as const
});
export const catapultCrankHands = (angle: number) => [-1, 1].map(sign => [CATAPULT_CRANK.gripX,
  CATAPULT_CRANK.pivot[1] + CATAPULT_CRANK.radius * Math.cos(angle) - sign * CATAPULT_CRANK.halfSpanZ * Math.sin(angle),
  CATAPULT_CRANK.pivot[2] + CATAPULT_CRANK.radius * Math.sin(angle) + sign * CATAPULT_CRANK.halfSpanZ * Math.cos(angle)] as const);
export const catapultReleasePoint = () => {
  const lift = CATAPULT_SCOOP.innerFloor * CATAPULT_SCOOP.size[1] + CATAPULT_STONE_DIAMETER / 2 + CATAPULT_STONE_SEAT_LIFT;
  return [CATAPULT_ENGINE_ORIGIN[0], CATAPULT_SCOOP.position[1] + Math.cos(CATAPULT_SCOOP.pitch) * lift,
    CATAPULT_SCOOP.position[2] + Math.sin(CATAPULT_SCOOP.pitch) * lift] as const;
};
