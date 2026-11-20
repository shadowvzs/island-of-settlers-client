import type { Vec3 } from "../../props/mesh-builder";
import { type Coat, mottle, type QuadShape } from "./quadruped-shape";

const MARMOT = {
  back: [0.46, 0.39, 0.31] as Vec3,
  belly: [0.62, 0.43, 0.26] as Vec3,
  cap: [0.24, 0.19, 0.15] as Vec3,
  dark: [0.14, 0.11, 0.09] as Vec3,
  muzzle: [0.8, 0.74, 0.63] as Vec3
};

/** Alpine marmot: grizzled grey-brown back, rusty belly, dark cap, pale muzzle, dark tail tip. */
const marmotCoat: Coat = (part, along, up, _side, at) => {
  if (part === "eye" || part === "nose" || part === "foot") return MARMOT.dark;
  if (part === "snout") return MARMOT.muzzle;
  if (part === "head") return up > 0.3 ? MARMOT.cap : mottle(MARMOT.back, at, 0.2);
  if (part === "tail") return along > 0.7 ? MARMOT.dark : mottle(MARMOT.back, at, 0.25);
  if (part === "leg" || part === "ear") return mottle(MARMOT.belly, at, 0.15);
  return mottle(up < -0.3 ? MARMOT.belly : MARMOT.back, at, 0.3);
};

export const MARMOT_SHAPE: QuadShape = {
  body: [
    [-0.5, 0.7, 0.7, 0.05],
    [-0.3, 0.98, 1, 0],
    [-0.05, 1, 1, 0],
    [0.2, 0.95, 0.95, 0.02],
    [0.4, 0.85, 0.85, 0.06],
    [0.52, 0.6, 0.6, 0.12]
  ],
  bodyHeight: 0.055,
  bodyLength: 0.24,
  bodyWidth: 0.06,
  coat: marmotCoat,
  earLength: 0.014,
  earLie: 0.2,
  earWidth: 0.013,
  headLength: 0.055,
  headRadius: 0.035,
  legLength: 0.04,
  legRadius: 0.012,
  neckAngle: 0.25,
  neckLength: 0.03,
  neckRadius: 0.04,
  snoutLength: 0.025,
  snoutRadius: 0.018,
  tailDroop: 0.5,
  tailLength: 0.09,
  tailRadius: 0.016
};
