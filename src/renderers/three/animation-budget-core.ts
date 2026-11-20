import { type Camera, Raycaster, Vector2 } from "three";

/** One budget frame's camera, the ground point at screen centre and the presentation clock. */
export interface FrameFocus {
  beginFrame(camera: Camera | undefined, time: number): void;
  camera: Camera | undefined;
  cameraEntered: boolean;
  clock: number;
  focusX: number;
  focusZ: number;
  frame: number;
}

/**
 * The per-frame camera sample shared by the worker and mount animation budgets: the ground point
 * at screen centre (proximity to what the camera looks at) and whether the camera just entered.
 */
export const createFrameFocus = (): FrameFocus => {
  const raycaster = new Raycaster();
  const centre = new Vector2(0, 0);
  let hasCamera = false;
  const focus: FrameFocus = {
    beginFrame: (nextCamera, time) => {
      focus.frame++;
      focus.clock = Number.isFinite(time) ? time : focus.clock;
      focus.cameraEntered = Boolean(nextCamera) && !hasCamera;
      hasCamera = Boolean(nextCamera);
      focus.camera = nextCamera;
      if (!nextCamera) return;
      nextCamera.updateMatrixWorld();
      raycaster.setFromCamera(centre, nextCamera);
      const { direction, origin } = raycaster.ray;
      const distance = Math.abs(direction.y) > 1e-6 ? -origin.y / direction.y : -1;
      if (distance >= 0 && Number.isFinite(distance)) {
        focus.focusX = origin.x + direction.x * distance;
        focus.focusZ = origin.z + direction.z * distance;
      } else {
        focus.focusX = nextCamera.position.x;
        focus.focusZ = nextCamera.position.z;
      }
    },
    camera: undefined,
    cameraEntered: false,
    clock: 0,
    focusX: 0,
    focusZ: 0,
    frame: 0
  };
  return focus;
};
