import type { WorkerFrame } from "./worker-unit";

/** A fall lasts this long and ends with the body lying flat. */
const FALL_SECONDS = .8;
const FALL_ANGLE = 1.45;
/** Share of the fall in which the knees give way before the body tips over. */
export const BUCKLE = .3;

/**
 * The drawn figure of a fallen foot soldier `age` seconds after its death: the weapon dropped
 * (no combat gear), the knees buckle (`fall`, worker-fall-pose.ts), then it tips over forward
 * onto the ground; null once the fall is over.
 */
export const fallenSoldierFrame = (body: WorkerFrame, age: number): WorkerFrame | null => {
  if (age >= FALL_SECONDS) return null;
  const t = age / FALL_SECONDS, tip = Math.max(0, (t - BUCKLE) / (1 - BUCKLE));
  return { ...body, action: "idle_breathe", carryingWare: null, combat: undefined, fallenBandit: body.combat?.bandit, fall: t,
    lean: FALL_ANGLE * tip * tip, selected: false, visible: true, wareTransfer: undefined, workerTool: undefined };
};
