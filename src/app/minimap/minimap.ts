import { type CameraState,clampCamera } from "../../render-common/camera-state";
import { ROAD_APPEARANCE } from "../../render-common/road-appearance";
import { DEFAULT_PLAYER_COLOR } from "../../render-common/settlement/player-color";
import type { RoadSegment } from "../../shared/settlement/road-types";
import type { SettlementTerritory } from "../../shared/settlement/settlement-territory";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { displayFogAt } from "../../shared/world/fog-display";
import type { WorldData } from "../../shared/world/world-data";
import { createLazyReactContent } from "../components/lazy-react-content";
import { createExternalStore } from "../components/ui-store";
import { getViewOutline } from "../helpers";
import { makeSettlementPanelDraggable } from "../settlement-ui/drag";
import { getWindowLayer, isolatePointer } from "../window-layer";
import { createMinimapProjection, minimapFraction, type MinimapPoint } from "./minimap-geometry";
import { createMinimapImage } from "./minimap-image";
import { createMinimapRefreshScheduler } from "./minimap-refresh";
import { createTerritoryMask } from "./minimap-territory";

/** CSS width of the minimap (the diamond is half as tall). */
const MINIMAP_WIDTH = 240;
/** The fog of war can lift while playing: the map image is rebuilt this often (ms). */
const IMAGE_REFRESH_MS = 2000;
const OUTLINE_COLOR = "#f3dfa2";
/** Longest wait for an idle moment before the header's React content mounts anyway (ms). */
const HEADER_MOUNT_TIMEOUT_MS = 2000;

export interface MinimapOptions {
  camera: CameraState;
  viewport: HTMLElement;
  visible: boolean;
  world: WorldData;
  /** Player-territory toggle; hidden for the standalone editor, which has no player territory. */
  showTerritoryToggle?: boolean;
  getSettlement?: () =>
    { buildings: readonly SettlementBuilding[]; roads: readonly RoadSegment[];
      territory?: SettlementTerritory; playerColor?: readonly number[] } | undefined;
}

/** Bakes the world image into an offscreen canvas (one pixel per cell). */
const bakeImage = (world: WorldData) => {
  const image = createMinimapImage(world);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
};

const createCanvas = (width: number, height: number) => {
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.className = "minimap__canvas";
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return { canvas, ratio };
};

/**
 * Minimap defaults to the bottom left: the island as the iso diamond of the main view (water,
 * ground, forests, mine fields, fog of war) with the camera's view outline; click or drag on it
 * to move the camera there. Redraws only when the camera moved or the image was rebuilt. The canvas stays
 * imperative; the header (drag handle) hosts the React title and territory toggle once the island is shown.
 */
export const createMinimap = ({
  camera,
  getSettlement,
  showTerritoryToggle = true,
  viewport,
  visible,
  world
}: MinimapOptions) => {
  const projection = createMinimapProjection(world, MINIMAP_WIDTH);
  const { canvas, ratio } = createCanvas(projection.width, projection.height);
  const element = document.createElement("div");
  element.className = "minimap";
  element.hidden = !visible;
  const header = document.createElement("header");
  header.className = "minimap__header";
  header.tabIndex = 0;
  header.setAttribute("aria-label", "Move minimap");
  header.title = "Drag to move minimap; arrow keys also move it";
  const map = document.createElement("div");
  map.className = "minimap__map";
  const marker = document.createElement("div");
  marker.className = "minimap__explorer";
  marker.hidden = true;
  marker.setAttribute("aria-hidden", "true");
  map.append(canvas, marker);
  element.append(header, map);
  /** Territory toggle of the React header; the canvas redraw reads it. */
  const territory = createExternalStore(false);
  const headerContent = createLazyReactContent(header, "Minimap", async () =>
    (await import("./mount-minimap-header")).createMinimapHeaderMount(territory, showTerritoryToggle));
  let islandShown = false;
  let disposed = false;
  let frameHandle = 0;
  /** React loads once the island is shown and the main thread is idle, off the loading path. */
  const mountHeader = () => {
    if (disposed || !islandShown || element.hidden) return;
    if ("requestIdleCallback" in window) requestIdleCallback(headerContent.mount, { timeout: HEADER_MOUNT_TIMEOUT_MS });
    else setTimeout(headerContent.mount, HEADER_MOUNT_TIMEOUT_MS);
  };
  let territoryImage: HTMLCanvasElement | undefined;
  let territoryColor = "";
  let territoryRevision = -1;
  getWindowLayer(viewport).append(element);
  const drag = makeSettlementPanelDraggable(element, header);
  const events = new AbortController();
  const context = canvas.getContext("2d")!;
  let image = bakeImage(world);
  let drawnView = "";
  /** Transient possessed-explorer marker; never part of the saved/base fog state. */
  let explorerMarker: { x: number; z: number } | null = null;
  let explorationActive = false;
  let normalHidden = element.hidden === true;
  /** The player's own dragged position, restored after the temporary bottom-left layout. */
  let normalPosition: { bottom: string; left: string; right: string; top: string } | null = null;
  let drawnMarker = "";

  const updateMarker = () => {
    if (!explorerMarker) {
      if (marker.hidden) return;
      marker.hidden = true;
      drawnMarker = "";
      return;
    }
    const fraction = minimapFraction(
      projection.toMinimap(explorerMarker.x, explorerMarker.z),
      projection.width,
      projection.height
    );
    const key = `${fraction.x.toFixed(4)},${fraction.y.toFixed(4)}`;
    if (key === drawnMarker) return;
    drawnMarker = key;
    marker.hidden = false;
    marker.style.left = `${(fraction.x * 100).toFixed(3)}%`;
    marker.style.top = `${(fraction.y * 100).toFixed(3)}%`;
  };

  const drawOutline = () => {
    const corners = getViewOutline(camera).map(({ x, z }) => projection.toMinimap(x, z));
    context.beginPath();
    corners.forEach(({ x, y }, index) =>
      index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
    );
    context.closePath();
    context.lineWidth = 1.5;
    context.strokeStyle = OUTLINE_COLOR;
    context.stroke();
  };

  const draw = () => {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, projection.width, projection.height);
    const [a, b, c, d] = projection.imageTransform;
    context.setTransform(
      a * ratio,
      b * ratio,
      c * ratio,
      d * ratio,
      projection.imageOffsetX * ratio,
      0
    );
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0);
    const settlement = getSettlement?.();
    if (territory.getSnapshot() && settlement?.territory) {
      const color = settlement.playerColor ?? DEFAULT_PLAYER_COLOR;
      if (territoryRevision !== settlement.territory.revision || !territoryImage ||
        territoryColor !== color.join(",")) {
        territoryColor = color.join(",");
        territoryImage = document.createElement("canvas");
        territoryImage.width = world.cellsX; territoryImage.height = world.cellsZ;
        const data = createTerritoryMask(world, settlement.territory.owned, color);
        territoryImage.getContext("2d")!.putImageData(new ImageData(data, world.cellsX, world.cellsZ), 0, 0);
        territoryRevision = settlement.territory.revision;
      }
      context.drawImage(territoryImage, 0, 0);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (settlement) {
      context.lineWidth = 1;
      for (const road of settlement.roads) {
        const start = projection.toMinimap(road.start.x, road.start.z);
        const end = projection.toMinimap(road.end.x, road.end.z);
        context.strokeStyle = ROAD_APPEARANCE[road.tier].colour;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      }
      for (const building of settlement.buildings) {
        const cell = Math.floor(building.z) * world.cellsX + Math.floor(building.x);
        if (!displayFogAt(world, cell)) continue;
        const point = projection.toMinimap(building.x, building.z);
        const size = building.typeId === 0 ? 4 : 2.5;
        context.fillStyle = building.construction < 1 ? "#e1b36d" : "#9cbdff";
        context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
      }
    }
    drawOutline();
  };

  const frame = () => {
    if (disposed) return;
    updateMarker();
    const view = [camera.centerX, camera.centerZ, camera.zoom, camera.yaw, camera.viewportWidth];
    const key = view.map((value) => value.toFixed(2)).join();
    if (!element.hidden && key !== drawnView) {
      drawnView = key;
      draw();
    }
    frameHandle = requestAnimationFrame(frame);
  };

  const moveCamera = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    const point: MinimapPoint = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const target = projection.toWorld(point);
    camera.centerX = target.x;
    camera.centerZ = target.z;
    clampCamera(camera, world.cellsX, world.cellsZ);
  };

  const unsubscribeTerritory = territory.subscribe(() => { drawnView = ""; });
  isolatePointer(element, undefined, events.signal);
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    moveCamera(event);
  }, { signal: events.signal });
  canvas.addEventListener("pointermove", (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) moveCamera(event);
  }, { signal: events.signal });
  /** Rebakes the world image (fog of war lifted, map editor edits). */
  const refresh = () => {
    if (disposed || element.hidden) return;
    image = bakeImage(world);
    territoryRevision = -1;
    drawnView = "";
  };
  const refreshScheduler = createMinimapRefreshScheduler({
    bake: refresh,
    isVisible: () => !disposed && !element.hidden,
    schedule: (callback) => window.requestAnimationFrame(callback)
  });
  const refreshInterval = window.setInterval(refreshScheduler.request, IMAGE_REFRESH_MS);
  frameHandle = requestAnimationFrame(frame);

  const enterExploration = () => {
    if (disposed || explorationActive) return;
    explorationActive = true;
    normalHidden = element.hidden === true;
    normalPosition = {
      bottom: element.style.bottom,
      left: element.style.left,
      right: element.style.right,
      top: element.style.top
    };
    element.hidden = false;
    element.classList.add("minimap--exploration");
    drawnView = "";
    drawnMarker = "";
    refresh();
  };

  const leaveExploration = () => {
    if (!explorationActive) return;
    explorationActive = false;
    explorerMarker = null;
    marker.hidden = true;
    drawnMarker = "";
    element.classList.remove("minimap--exploration");
    // The window drag/ResizeObserver path may have written the temporary bottom-left box while the
    // map was shown; restore the player's real drag position rather than accepting that write.
    if (normalPosition) {
      element.style.bottom = normalPosition.bottom;
      element.style.left = normalPosition.left;
      element.style.right = normalPosition.right;
      element.style.top = normalPosition.top;
      normalPosition = null;
    }
    element.hidden = normalHidden;
    drawnView = "";
    if (!element.hidden) {
      refresh();
      mountHeader();
    }
  };

  return {
    /** Releases the RAF, refresh interval, pointer/window listeners and the lazily mounted header. */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameHandle);
      clearInterval(refreshInterval);
      events.abort();
      unsubscribeTerritory();
      drag.dispose();
      headerContent.dispose();
      element.remove();
    },
    /** The island is shown (loading finished): the header's React content may load. */
    onIslandShown: () => {
      if (disposed) return;
      islandShown = true;
      mountHeader();
    },
    refresh,
    /** One bake for all requests before the next frame (the map editor's edit paths). */
    requestRefresh: () => {
      if (!disposed) refreshScheduler.request();
    },
    /**
     * Shows the map in its temporary possessed layout and moves the white explorer dot. Passing null
     * restores the pre-possession visibility/drag layout; no preference or save state is written.
     */
    setExplorerMarker: (point: { x: number; z: number } | null) => {
      if (disposed) return;
      if (!point) {
        leaveExploration();
        return;
      }
      explorerMarker = { x: point.x, z: point.z };
      if (!explorationActive) enterExploration();
    },
    isVisible: () => !element.hidden,
    setVisible: (shown: boolean) => {
      if (disposed) return;
      // The normal Map toggle is hidden while possessed; remember its preference without disturbing
      // the temporary exploration layout if another owner still calls this.
      if (explorationActive) {
        normalHidden = !shown;
        return;
      }
      element.hidden = !shown;
      if (shown) { drag.activate(); refresh(); mountHeader(); }
      drawnView = "";
    }
  };
};
