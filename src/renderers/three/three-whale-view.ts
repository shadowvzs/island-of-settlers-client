import { type Camera, Vector3 } from "three";

import type { WhaleView } from "../../render-common/whales/whale-site";

/** Screen share (NDC) a point may sit from the border and still count as in view. */
const VIEW_LIMIT = 0.92;

/**
 * The whales' view questions answered with the active camera (iso or possessed): where the screen
 * meets the sea, whether a point is on screen, how large the body appears.
 */
export const createWhaleView = () => {
  const near = new Vector3();
  const far = new Vector3();
  const point = new Vector3();
  const other = new Vector3();
  const up = new Vector3();
  let active: Camera | null = null;

  const castToPlane: WhaleView["castToPlane"] = (viewX, viewY, height, out) => {
    if (!active) return false;
    near.set(viewX, viewY, -1).unproject(active);
    far.set(viewX, viewY, 1).unproject(active).sub(near);
    if (far.y > -1e-4) return false;
    const distance = (height - near.y) / far.y;
    out.x = near.x + far.x * distance;
    out.z = near.z + far.z * distance;
    return true;
  };

  const whaleView: WhaleView = {
    castToPlane,
    eyeX: 0,
    eyeZ: 0,
    forwardX: 0,
    forwardZ: 1,
    limitDistance: false,
    inView: (x, y, z) => {
      if (!active) return false;
      point.set(x, y, z).project(active);
      return Math.abs(point.x) < VIEW_LIMIT && Math.abs(point.y) < VIEW_LIMIT && point.z > -1 && point.z < 1;
    }
  };

  /**
   * Called once per frame before the director asks (the camera is posed for the frame). Only the
   * possessed eye limits the distance; the iso camera only needs the event on screen.
   */
  const setCamera = (camera: Camera, possessed: boolean) => {
    active = camera;
    camera.updateMatrixWorld();
    camera.getWorldDirection(point);
    const horizontal = Math.hypot(point.x, point.z) || 1;
    whaleView.forwardX = point.x / horizontal;
    whaleView.forwardZ = point.z / horizontal;
    whaleView.limitDistance = possessed;
    whaleView.eyeX = camera.position.x;
    whaleView.eyeZ = camera.position.z;
  };

  return {
    /** Screen height share (NDC / 2) a world length upright at `at` covers. */
    projectedSize: (camera: Camera, at: Vector3, length: number) => {
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      point.copy(at).project(camera);
      other.copy(at).addScaledVector(up, length).project(camera);
      return Math.hypot(other.x - point.x, other.y - point.y) / 2;
    },
    setCamera,
    whaleView
  };
};
