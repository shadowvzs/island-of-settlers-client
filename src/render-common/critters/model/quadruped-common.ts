import type { Vec3 } from "../../props/mesh-builder";
import type { Paint } from "./critter-builder";
import type { QuadPart, QuadPose, QuadShape } from "./quadruped-shape";

/** Paint of one part: the coat with the vertex position (patterns need it). */
export const paintPart =
  (shape: QuadShape, part: QuadPart, at: () => Vec3): Paint =>
  (along, up, side) =>
    shape.coat(part, along, up, side, at());

/** Body centre height: standing on the legs, or lying with the belly on the ground. */
export const getBodyY = (shape: QuadShape, pose: QuadPose) => {
  const standing = shape.legLength + shape.bodyHeight;
  return standing + (shape.bodyHeight * 0.92 - standing) * pose.rest;
};

