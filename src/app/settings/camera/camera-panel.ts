import type { I18n } from "@lingui/core";

import type { CameraState } from "../../../render-common/camera-state";
import type { TerrainRenderer } from "../../../render-common/renderer-contract";
import { createLazyReactContent } from "../../components/lazy-react-content";
import { createExternalStore } from "../../components/ui-store";
import type { ObservationPickKind } from "../../observation/helpers";
import type { CameraBookmarkControls } from "./bookmark-controls";
import { createCameraPad } from "./camera-pad";
import { createZoomControl } from "./zoom-control";

export interface CameraPanelOptions {
  bookmarks?: CameraBookmarkControls;
  i18n?: I18n;
  camera: CameraState;
  /** Whether the camera panel is open (the zoom limits loop runs only then). */
  isShown: () => boolean;
  mapSize: readonly [number, number];
  renderer: Pick<TerrainRenderer, "getViewMode">;
  resetCamera: () => void;
  toggleCinematic: () => void;
  /** Watch worker / ship clicked: start picking (and close the panel; the caller wires both). */
  watch?: (kind: ObservationPickKind) => void;
}

/**
 * Camera corner panel content: zoom, pad and bookmark services stay in TypeScript (hold loops mutate the
 * camera, stores publish only changes); React renders the controls on the panel's first open.
 */
export const createCameraPanelContent = (options: CameraPanelOptions) => {
  const [cellsX, cellsZ] = options.mapSize;
  const cinematic = createExternalStore(false);
  const refresh = () => cinematic.set(options.renderer.getViewMode() === "cinematic");
  const zoom = createZoomControl({ camera: options.camera, cellsX, cellsZ, isShown: options.isShown });
  const content = document.createElement("div");
  content.className = "camera-panel__content";
  const props = {
    bookmarks: options.bookmarks,
    cinematic,
    i18n: options.i18n,
    pad: createCameraPad(options.camera, options.mapSize, options.i18n),
    zoom,
    onCinematic: () => {
      options.toggleCinematic();
      refresh();
    },
    onReset: () => {
      options.resetCamera();
      refresh();
    },
    onWatch: options.watch
  };
  const view = createLazyReactContent(content, "Camera controls", async () =>
    (await import("./mount-camera-panel")).createCameraPanelMount(props));
  return {
    content,
    dispose: () => {
      view.dispose();
      zoom.dispose();
      content.remove();
    },
    /** Panel opened: live cinematic state, zoom limits loop, React content (first open). */
    open: () => {
      refresh();
      zoom.start();
      view.mount();
    },
    refresh
  };
};
