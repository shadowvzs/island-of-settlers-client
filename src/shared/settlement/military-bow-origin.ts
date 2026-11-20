import { commanderBowHandTargets } from "../../render-common/workers/commander-bow-aim";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import type { SettlementActor } from "./settlement-types";

/**
 * Current mounted bow catalogue = Nubian rider. Measured actual horse Saddle hierarchy plus Nubian
 * idle seated-vs-standing pelvis displacement (model.glb/actions.glb), not an invented horse height.
 * A source-asset regression test verifies these numbers; normal standing archer origin is unchanged.
 */
export const MOUNTED_BOW_LIFT = (1.0023366723491127 - .5038646599625606) * WORKER_SCALE;
export const MOUNTED_BOW_FORWARD = .12474956278342057 * WORKER_SCALE;
export const militaryBowOrigin = (actor: Pick<SettlementActor, "mounted" | "x" | "y" | "yaw" | "z">) => {
  const forward = .33 + (actor.mounted ? MOUNTED_BOW_FORWARD : 0);
  return { x: actor.x + DMath.cos(actor.yaw) * .146 + DMath.sin(actor.yaw) * forward,
    z: actor.z - DMath.sin(actor.yaw) * .146 + DMath.cos(actor.yaw) * forward,
    y: actor.y + .815 + (actor.mounted ? MOUNTED_BOW_LIFT : 0) };
};

/** The manual pose keeps its real bow grip steady through drawing; pitch rotates it about the shoulder. */
export const militaryManualBowOrigin = (actor: Pick<SettlementActor, "mounted" | "x" | "y" | "yaw" | "z">,
  pitch: number) => {
  const hand = commanderBowHandTargets(pitch, 0).left;
  const left = hand[0] * WORKER_SCALE;
  const forward = hand[2] * WORKER_SCALE + (actor.mounted ? MOUNTED_BOW_FORWARD : 0);
  return { x: actor.x + DMath.cos(actor.yaw) * left + DMath.sin(actor.yaw) * forward,
    y: actor.y + hand[1] * WORKER_SCALE + (actor.mounted ? MOUNTED_BOW_LIFT : 0),
    z: actor.z - DMath.sin(actor.yaw) * left + DMath.cos(actor.yaw) * forward };
};
