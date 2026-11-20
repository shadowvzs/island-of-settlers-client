import { type Camera, Frustum, Matrix4, Sphere } from "three";

/** Cells around a worker's feet that can still show it: body, held pole, lead rope, a long lean. */
export const WORKER_CULL_RADIUS = 2.5;
/** Sphere centre above the feet (half a worker's height). */
const CENTRE_HEIGHT = 0.5;

/**
 * Whether a worker can appear in this frame's view. Posing and the bone matrices of an off-screen
 * worker are skipped: with a hundred skinned workers they were the largest CPU cost of a frame.
 */
export const createWorkerViewCull = () => {
  const frustum = new Frustum();
  const matrix = new Matrix4();
  const sphere = new Sphere(undefined, WORKER_CULL_RADIUS);
  let active = false;
  return {
    /** This frame's camera; without one every worker counts as visible. */
    setCamera: (camera: Camera | undefined) => {
      active = Boolean(camera);
      if (!camera) return;
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    },
    contains: (x: number, y: number, z: number) => {
      if (!active) return true;
      sphere.center.set(x, y + CENTRE_HEIGHT, z);
      return frustum.intersectsSphere(sphere);
    }
  };
};
