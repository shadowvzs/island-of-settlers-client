import type { CameraState } from "../../../render-common/camera-state";
import { createCameraBookmarks } from "../../camera-bookmarks";
import { createExternalStore } from "../../components/ui-store";

type ViewMode = "iso" | "cinematic";

interface CameraBookmarkControlsOptions {
  camera: CameraState;
  initial?: unknown;
  mapSize: readonly [number, number];
  getViewMode: () => ViewMode;
  onRestore: () => void;
  setViewMode: (mode: ViewMode) => void;
}

/**
 * Camera bookmarks of the island (saved with the game): the list is published to a store for the camera
 * panel; add / go / remove act on the camera and the bookmark list directly.
 */
export const createCameraBookmarkControls = (options: CameraBookmarkControlsOptions) => {
  const bookmarks = createCameraBookmarks(options.initial);
  const entries = createExternalStore(bookmarks.list());
  const publish = () => entries.set(bookmarks.list());
  return {
    entries,
    /** False when the name is empty / too long or every slot is used. */
    add: (name: string) => {
      const added = bookmarks.add(name, options.camera, options.getViewMode());
      if (added) publish();
      return added;
    },
    go: (index: number) => {
      options.onRestore();
      const mode = bookmarks.restore(index, options.camera, options.mapSize);
      if (mode) options.setViewMode(mode);
    },
    remove: (index: number) => {
      bookmarks.remove(index);
      publish();
    },
    saveState: bookmarks.list
  };
};

export type CameraBookmarkControls = ReturnType<typeof createCameraBookmarkControls>;
