import {
  projectToScreen,
  unprojectToPlane,
  VIEW_DIRECTION,
  type ViewportPoint
} from "../src/render-common/iso-projection";

/** The fixed iso camera of the reference math: centre, zoom and viewport (CSS pixels). */
export interface IsoView {
  centerX: number;
  centerZ: number;
  viewportHeight: number;
  viewportWidth: number;
  zoom: number;
}

/** Viewport position of a world point in the fixed iso view around a camera centre and zoom. */
export const projectIsoToViewport = (
  view: IsoView,
  x: number,
  y: number,
  z: number
): ViewportPoint => {
  const centre = projectToScreen(view.centerX, 0, view.centerZ);
  const point = projectToScreen(x, y, z);
  return {
    depth: -(x * VIEW_DIRECTION.x + y * VIEW_DIRECTION.y + z * VIEW_DIRECTION.z),
    x: (point.screenX - centre.screenX) * view.zoom + view.viewportWidth / 2,
    y: (point.screenY - centre.screenY) * view.zoom + view.viewportHeight / 2
  };
};

/**
 * The ray through a viewport pixel of the fixed iso view (picking): it starts above the highest
 * ground `top` and runs along the view direction into the scene.
 */
export const getIsoViewRay = (view: IsoView, viewportX: number, viewportY: number, top: number) => {
  const centre = projectToScreen(view.centerX, 0, view.centerZ);
  const screenX = (viewportX - view.viewportWidth / 2) / view.zoom + centre.screenX;
  const screenY = (viewportY - view.viewportHeight / 2) / view.zoom + centre.screenY;
  const ground = unprojectToPlane(screenX, screenY, 0);
  const lift = top / VIEW_DIRECTION.y;
  return {
    direction: { x: -VIEW_DIRECTION.x, y: -VIEW_DIRECTION.y, z: -VIEW_DIRECTION.z },
    origin: {
      x: ground.x + VIEW_DIRECTION.x * lift,
      y: top,
      z: ground.z + VIEW_DIRECTION.z * lift
    }
  };
};
