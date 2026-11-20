import type { CameraState } from "../../render-common/camera-state";
import type { PlacementPreviewFrame, TerrainRenderer } from "../../render-common/renderer-contract";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { getViewOutline } from "../helpers";
import type { FitSelection } from "./building-fit-spots";
import { createPackingScratch, type FitSpots, packPreviewPlots, plotsOverlap } from "./preview-packing";

type Point = { x: number; z: number };

/** Most preview ghosts at once per detail level (measured on the largest island, see docs). */
export const PREVIEW_CAP = { high: 32, minimal: 24 } as const;
/** Cells kept free between two previews, so each ghost reads as its own building. */
const PREVIEW_GAP = 1;
/** The view moves this far (cells), turns (radians) or zooms (ratio) before the previews repack. */
const REPACK = { move: 1.5, turn: 0.05, zoom: 0.08 } as const;
/** Height of a preview's pick box over its plot, per cell of its longer side (plus one unit). */
const PICK_HEIGHT_PER_CELL = 0.6;

export interface PlacementPreviewInput {
  camera: CameraState;
  /** Plot centre of the cursor ghost (null: none); previews under it are hidden. */
  cursor: Point | null;
  fitRevision: number;
  nation: WorkerNation;
  selection: FitSelection | null;
  spots: FitSpots | null;
}

/** The camera view of the last packing: repacks only when it changed noticeably. */
const createViewMemory = () => {
  const view = { centerX: NaN, centerZ: NaN, height: 0, width: 0, yaw: 0, zoom: 1 };
  const changed = (camera: CameraState) =>
    Math.hypot(camera.centerX - view.centerX, camera.centerZ - view.centerZ) > REPACK.move ||
    Math.abs(camera.yaw - view.yaw) > REPACK.turn || Math.abs(camera.zoom / view.zoom - 1) > REPACK.zoom ||
    camera.viewportWidth !== view.width || camera.viewportHeight !== view.height;
  const remember = (camera: CameraState) => Object.assign(view, { centerX: camera.centerX,
    centerZ: camera.centerZ, height: camera.viewportHeight, width: camera.viewportWidth, yaw: camera.yaw,
    zoom: camera.zoom });
  const forget = () => { view.centerX = NaN; };
  return { changed, forget, remember };
};

/**
 * The preview ghosts of the building being placed: a non-overlapping set of its valid plots in
 * view, nearest the camera centre first, at most `cap`. Repacks only when the fit spots, the
 * selection or the camera view change noticeably; the frame's instances are rewritten only then
 * or when the cursor ghost moves to another plot (previews under it hide). A frame without changes
 * allocates nothing.
 */
export const createPlacementPreviews = (
  world: WorldData, renderer: Pick<TerrainRenderer, "projectToViewport">, cap: number
) => {
  const chosen = new Int32Array(cap), scratch = createPackingScratch(), view = createViewMemory();
  const frame: PlacementPreviewFrame = { count: 0, nation: "roman", positions: new Float32Array(cap * 3),
    revision: 0, rotation: 0, type: -1 };
  const packed = { count: 0, fitRevision: -1, rotation: -1, type: -1 };
  const cursorPlot = { x: NaN, z: NaN }, plot = { x: 0, z: 0 };
  let spots: FitSpots | null = null;

  const repack = (input: PlacementPreviewInput, selection: FitSelection, fitSpots: FitSpots) => {
    const { camera } = input;
    const focus = { x: camera.centerX, z: camera.centerZ };
    packed.count = packPreviewPlots({ cap, cellsX: world.cellsX, focus, gap: PREVIEW_GAP, spots: fitSpots,
      view: getViewOutline(camera) }, chosen, scratch);
    Object.assign(packed, { fitRevision: input.fitRevision, rotation: selection.rotation, type: selection.typeId });
    view.remember(camera);
  };

  const needsRepack = (input: PlacementPreviewInput, selection: FitSelection) =>
    packed.fitRevision !== input.fitRevision || packed.type !== selection.typeId ||
    packed.rotation !== selection.rotation || view.changed(input.camera);

  /** Top-left cell of the cursor ghost's plot (NaN: no cursor ghost). */
  const setCursorPlot = (cursor: Point | null, fitSpots: FitSpots) => {
    const x = cursor ? cursor.x - fitSpots.width / 2 : NaN, z = cursor ? cursor.z - fitSpots.depth / 2 : NaN;
    if (Object.is(x, cursorPlot.x) && Object.is(z, cursorPlot.z)) return false;
    cursorPlot.x = x; cursorPlot.z = z;
    return true;
  };

  const writeFrame = (input: PlacementPreviewInput, fitSpots: FitSpots) => {
    let count = 0;
    for (let index = 0; index < packed.count; index++) {
      plot.x = chosen[index]! % world.cellsX;
      plot.z = (chosen[index]! - plot.x) / world.cellsX;
      if (plotsOverlap(fitSpots, plot, cursorPlot)) continue;
      const x = plot.x + fitSpots.width / 2, z = plot.z + fitSpots.depth / 2;
      frame.positions[count * 3] = x;
      frame.positions[count * 3 + 1] = sampleSmooth(world, world.heights, x, z);
      frame.positions[count * 3 + 2] = z;
      count++;
    }
    Object.assign(frame, { count, nation: input.nation, rotation: packed.rotation * Math.PI / 2,
      type: packed.type });
    frame.revision++;
  };

  /** The preview frame for this frame's input (null: nothing to preview). */
  const update = (input: PlacementPreviewInput) => {
    const { selection } = input;
    spots = input.spots;
    if (!selection || !spots) {
      packed.count = 0; packed.fitRevision = -1; view.forget();
      return null;
    }
    const repacked = needsRepack(input, selection);
    if (repacked) repack(input, selection, spots);
    const cursorMoved = setCursorPlot(input.cursor, spots);
    if (repacked || cursorMoved || frame.nation !== input.nation) writeFrame(input, spots);
    return frame.count > 0 ? frame : null;
  };

  /** Screen box of a chosen preview (its plot and a building-high box over it) holds the point. */
  const hits = (left: number, top: number, fitSpots: FitSpots, screenX: number, screenY: number) => {
    const height = 1 + PICK_HEIGHT_PER_CELL * Math.max(fitSpots.width, fitSpots.depth);
    const ground = sampleSmooth(world, world.heights, left + fitSpots.width / 2, top + fitSpots.depth / 2);
    let maxX = -Infinity, maxY = -Infinity, minX = Infinity, minY = Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const x = left + (corner & 1) * fitSpots.width, z = top + ((corner >> 1) & 1) * fitSpots.depth;
      const point = renderer.projectToViewport(x, ground + (corner >> 2) * height, z);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    }
    return screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY;
  };

  /**
   * Plot centre of the preview ghost under a viewport point (the nearest one to the camera when
   * boxes overlap), or null. Pointer moves call it, never the render frame.
   */
  const pick = (x: number, y: number): Point | null => {
    if (!spots || !packed.count) return null;
    let best: Point | null = null, bestDepth = Infinity;
    for (let index = 0; index < packed.count; index++) {
      const left = chosen[index]! % world.cellsX, top = (chosen[index]! - left) / world.cellsX;
      if (!hits(left, top, spots, x, y)) continue;
      const centre = { x: left + spots.width / 2, z: top + spots.depth / 2 };
      const { depth } = renderer.projectToViewport(centre.x, 0, centre.z);
      if (depth < bestDepth) { best = centre; bestDepth = depth; }
    }
    return best;
  };

  return { pick, update };
};
