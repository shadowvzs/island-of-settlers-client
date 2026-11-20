import type { CameraState } from "../../../render-common/camera-state";
import type { TerrainRenderer, ViewMode } from "../../../render-common/renderer-contract";

type ViewModeOwner = Pick<TerrainRenderer, "getViewMode" | "setViewMode">;

/** The RTS camera fields and the view mode a sequence starts from (plan section 3.3). */
export interface CameraSnapshot {
  camera: Pick<CameraState, "centerX" | "centerZ" | "tilt" | "yaw" | "zoom">;
  viewMode: ViewMode;
}

export const takeCameraSnapshot = (camera: CameraState, view: ViewModeOwner): CameraSnapshot => ({
  camera: { centerX: camera.centerX, centerZ: camera.centerZ, tilt: camera.tilt, yaw: camera.yaw, zoom: camera.zoom },
  viewMode: view.getViewMode()
});

/**
 * Puts the RTS camera and view mode back bit-identically. The director never writes the camera, so this is a guard
 * against anything else that might have (the viewport size is not part of it: a resize stays applied).
 */
export const restoreCameraSnapshot = (snapshot: CameraSnapshot, camera: CameraState, view: ViewModeOwner) => {
  Object.assign(camera, snapshot.camera);
  if (view.getViewMode() !== snapshot.viewMode) view.setViewMode(snapshot.viewMode);
};
