import type { CameraState } from "../../render-common/camera-state";
import type { PlacementPreviewFrame, TerrainRenderer } from "../../render-common/renderer-contract";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { WorldData } from "../../shared/world/world-data";
import { drawHarbourSpotMarkers, hasHarbourSpotMarkers } from "../harbour-spot-markers";
import { createOverlayCanvas, fitCanvasToViewport, getViewOutline } from "../helpers";
import { getBuildViewBounds, MIN_SPOT_ZOOM } from "./build-spots";
import { createBuildingFitSpots, type FitSelection, isMineBuilding } from "./building-fit-spots";
import { getMineOutlineKey } from "./mine-outline";
import { createMineOutlineLayer } from "./mine-outline-layer";
import { createMineTooltip } from "./mine-tooltip";
import { createNoSpaceNotice } from "./no-space-notice";
import { createPlacementPreviews } from "./placement-previews";

type Point = { x: number; z: number };
const HARBOUR_TYPE = 39;

export interface BuildOverlayOptions {
  camera: CameraState;
  /** Most preview ghosts shown at once. */
  previewCap: number;
  renderer: TerrainRenderer;
  viewport: HTMLElement;
  world: WorldData;
  /** Plot centre of the cursor ghost (null: none). */
  getCursorGhost: () => Point | null;
  getNation: () => WorkerNation;
  getOwnership: () => Uint8Array | undefined;
  /** The building being placed and its rotation (null: no placement in progress). */
  getPlacement: () => FitSelection | null;
  /** Changes whenever territory, buildings or roads change (placement validity). */
  getPlacementRevision: () => string;
  /** The selected building fits nowhere in the territory (told once per building and footprint turn). */
  onNoSpace: (typeId: number) => void;
  /** True while the geologist is being sent: the mine land and surveyed deposits are outlined. */
  showsMineLand: () => boolean;
  validatePlacement: (typeId: number, x: number, z: number, rotation: number) => string | null;
}

/**
 * Building placement aids, shown only while a building is selected (owner, 2026-10-13): every
 * plot of our territory where it fits is scanned (time sliced, see building-fit-spots), and a
 * non-overlapping set of them near the camera centre is shown as faint preview ghosts by the
 * renderer (`placementPreviews`). When the scan finds no plot at all, `onNoSpace` is told. While a
 * mine is being placed or the geologist sent, the mine land and surveyed deposits are outlined
 * (a canvas over the view, projected with the renderer's camera) with a hover tooltip.
 */
export const createBuildOverlay = (options: BuildOverlayOptions) => {
  const { camera, renderer, viewport, world } = options;
  const outlineCanvas = createOverlayCanvas(viewport, "build-overlay build-overlay--mine-outline");
  const outlineContext = outlineCanvas.getContext("2d")!;
  const harbourSpotCanvas = createOverlayCanvas(viewport, "build-overlay build-overlay--harbour-spots");
  const harbourSpotContext = harbourSpotCanvas.getContext("2d")!;
  const mineOutlines = createMineOutlineLayer(world, renderer);
  const tooltip = createMineTooltip(viewport, renderer, world);
  const fitSpots = createBuildingFitSpots({ getOwnership: options.getOwnership,
    validatePlacement: options.validatePlacement, world });
  const previews = createPlacementPreviews(world, renderer, options.previewCap);
  const tellNoSpace = createNoSpaceNotice(options.onNoSpace);
  let fitRevision = 0, previewFrame: PlacementPreviewFrame | null = null, running = true;
  let drawnView = "";
  /** Frames still to draw after the camera moved: the projection lags one frame behind. */
  let settling = 0;
  outlineCanvas.hidden = true;
  harbourSpotCanvas.hidden = true;
  let harbourSpotView = "", harbourSpotSettling = 0;

  const drawMineLand = () => {
    const ratio = fitCanvasToViewport(outlineCanvas, viewport);
    outlineContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    outlineContext.clearRect(0, 0, outlineCanvas.width, outlineCanvas.height);
    mineOutlines.draw(outlineContext, getBuildViewBounds(getViewOutline(camera)));
  };

  const cameraKey = () => [camera.centerX, camera.centerZ, camera.zoom, camera.yaw, camera.tilt,
    camera.viewportWidth, camera.viewportHeight, world.buildRevision ?? 0, world.fogRevision ?? 0]
    .map((value) => value.toFixed(3)).join();
  const mineLandKey = () => cameraKey() + getMineOutlineKey(world);

  /**
   * HARBOUR-SPOTS: a subtle outline of the map's stored harbour spots, only while a harbour is being
   * placed; redrawn only when the camera moved (hidden and free otherwise).
   */
  const updateHarbourSpots = (placement: FitSelection | null) => {
    const show = placement?.typeId === HARBOUR_TYPE && hasHarbourSpotMarkers(world);
    harbourSpotCanvas.hidden = !show;
    if (!show) { harbourSpotView = ""; return; }
    const key = cameraKey();
    if (key !== harbourSpotView) harbourSpotSettling = 2;
    harbourSpotView = key;
    if (harbourSpotSettling <= 0) return;
    harbourSpotSettling -= 1;
    const ratio = fitCanvasToViewport(harbourSpotCanvas, viewport);
    harbourSpotContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    harbourSpotContext.clearRect(0, 0, harbourSpotCanvas.width, harbourSpotCanvas.height);
    drawHarbourSpotMarkers(harbourSpotContext, world, renderer.projectToViewport.bind(renderer), "subtle");
  };

  /** Mine outlines and tooltip: redrawn only when the camera or the mine land changed. */
  const updateMineLand = (placement: FitSelection | null) => {
    const mineLand = (placement !== null && isMineBuilding(placement.typeId)) || options.showsMineLand();
    outlineCanvas.hidden = !mineLand || camera.zoom < MIN_SPOT_ZOOM;
    if (outlineCanvas.hidden) { tooltip.hide(); drawnView = ""; return; }
    const key = mineLandKey();
    if (key !== drawnView) settling = 2;
    drawnView = key;
    if (settling > 0) { settling -= 1; drawMineLand(); }
    tooltip.update(settling > 0);
  };

  const updatePlacement = (placement: FitSelection | null) => {
    const revisions = `${options.getPlacementRevision()}/${world.buildRevision ?? 0}/${getMineOutlineKey(world)}`;
    fitRevision = fitSpots.update(placement, revisions, { x: camera.centerX, z: camera.centerZ });
    tellNoSpace(placement, fitSpots.noSpace());
    previewFrame = previews.update({ camera, cursor: placement && options.getCursorGhost(), fitRevision,
      nation: options.getNation(), selection: placement, spots: placement && fitSpots.markers() });
  };

  const frame = () => {
    if (!running) return;
    const placement = options.getPlacement();
    updatePlacement(placement);
    updateMineLand(placement);
    updateHarbourSpots(placement);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    dispose: () => {
      running = false;
      tooltip.dispose();
      outlineCanvas.remove();
      harbourSpotCanvas.remove();
    },
    /** True while the selected building's spots are still being validated. */
    isScanning: () => fitSpots.isScanning(),
    /** Plot centre of the preview ghost under a viewport point (null: none). */
    pickPreview: previews.pick,
    /** The preview ghosts for the renderer (null: no placement or nothing fits in view). */
    placementPreviews: () => previewFrame
  };
};
