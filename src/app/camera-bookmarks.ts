import { type CameraState,clampCamera } from "../render-common/camera-state";

export const MAX_CAMERA_BOOKMARKS = 8;

/** Camera tilt range of restored bookmarks and the camera panel's pitch buttons. */
export const clampTilt = (tilt: number) => Math.max(-0.6, Math.min(0.95, tilt));

export interface CameraBookmark {
  name: string;
  viewMode: "iso" | "cinematic";
  camera: Pick<CameraState, "centerX" | "centerZ" | "zoom" | "yaw" | "tilt">;
}

/** Optional island-runtime data: bounded, detached, and never a cross-account preference. */
export const validCameraBookmarks = (value: unknown): value is CameraBookmark[] => {
  if (!Array.isArray(value) || value.length > MAX_CAMERA_BOOKMARKS) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object" || typeof item.name !== "string") return false;
    if (!item.name.trim() || item.name.length > 40) return false;
    if (!["iso", "cinematic"].includes(item.viewMode) || !item.camera) return false;
    const pose = item.camera;
    return [pose.centerX, pose.centerZ, pose.zoom, pose.yaw, pose.tilt].every(
      (number) => typeof number === "number" && Number.isFinite(number)
    );
  });
};

export const createCameraBookmarks = (initial: unknown = []) => {
  let bookmarks: CameraBookmark[] = [];
  if (validCameraBookmarks(initial)) bookmarks = structuredClone(initial);
  return {
    list: () => structuredClone(bookmarks),
    add: (name: string, camera: CameraState, viewMode: CameraBookmark["viewMode"]) => {
      if (bookmarks.length >= MAX_CAMERA_BOOKMARKS) return false;
      const { centerX, centerZ, tilt, yaw, zoom } = camera;
      const item = {
        name: name.trim().slice(0, 40),
        viewMode,
        camera: { centerX, centerZ, tilt, yaw, zoom }
      };
      if (!validCameraBookmarks([item])) return false;
      bookmarks.push(item);
      return true;
    },
    remove: (index: number) => {
      bookmarks = bookmarks.filter((_, current) => current !== index);
    },
    restore: (index: number, camera: CameraState, mapSize: readonly [number, number]) => {
      const item = bookmarks[index];
      if (!item) return null;
      Object.assign(camera, item.camera);
      camera.tilt = clampTilt(camera.tilt);
      camera.yaw %= Math.PI * 2;
      clampCamera(camera, ...mapSize);
      return item.viewMode;
    }
  };
};
