import { Matrix4, Quaternion, Vector3 } from "three";
import { FISHING_SKIFF_BEAM } from "./fishing-skiff-dimensions";
import { LIGHTER_BEAM } from "./lighter-dimensions";

/** One stored hull pose, used by both the yard model and the worker's first lift frame. */
const lean = .21, halfBeam = .5077 * FISHING_SKIFF_BEAM / LIGHTER_BEAM, keel = .099 * .78;
export const FISHING_SKIFF_RIM_HEIGHT = .3 * .78;
export const FISHING_SKIFF_STOW_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -lean)
  .multiply(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
    new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0))));
export const FISHING_SKIFF_STOW_OFFSET = new Vector3(0, halfBeam * Math.cos(lean) + .01,
  keel + halfBeam * Math.sin(lean) + .02);
