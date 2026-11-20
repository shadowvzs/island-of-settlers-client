import type { FrameState, TerrainRenderer } from "../../render-common/renderer-contract";
import { randomWorkerAppearances } from "../../render-common/workers/worker-appearance";
import { START_WORKER_COUNT } from "../../render-common/workers/worker-group";
import type { WorldData } from "../../shared/world/world-data";
import type { AppParams } from "../app-params";
import { FOLIAGE_SEED } from "../asset-seeds";
import { type IslandAssets, loadIslandAssets, loadRenderer, workerPoolSize } from "../island-assets";
import { openIslandCache } from "../island-cache";
import { createLoadingScreen } from "../loading-screen";
import { createPoolBuilders, createSharedBuilders } from "../pool-builders";
import { syncViewport } from "../render-loop";
import { chooseGraphics } from "../settings/choose-graphics";
import { readGraphicsOptions } from "../settings/graphics-settings";
import { createWorkerPool } from "../worker-pool";
import { decompressSceneBytes, unpackSceneData } from "./codec";
import { inheritSharedFields, restoreSceneFrame } from "./frame-snapshot";
import { createFrameInterpolator } from "./interpolation";
import type { SceneReplay, SceneSegment } from "./journal";
import { createScenePlayer, nextSceneSegment } from "./player";
import { addPlaybackControls, createReplayPanel } from "./replay-panel";
import type { SceneReplayBoot } from "./runtime";
import { createWorldScrubber } from "./world-scrubber";

/** A hidden canvas on top of the playing one: the next island builds there, then they swap. */
const HIDDEN_CANVAS_STYLE = "position:absolute;inset:0;width:100%;height:100%;visibility:hidden";

interface ViewerServices {
  assets: IslandAssets;
  graphics: ReturnType<typeof readGraphicsOptions>;
  pool: ReturnType<typeof createWorkerPool>;
  rendererModule: Awaited<ReturnType<typeof loadRenderer>>;
  shared: ReturnType<typeof createSharedBuilders>;
}

interface ReplayIsland {
  canvas: HTMLCanvasElement;
  index: number;
  player: ReturnType<typeof createScenePlayer>;
  renderer: TerrainRenderer;
  scrub: (revision: number) => void;
  size: { viewportHeight: number; viewportWidth: number };
  updateControls: () => void;
  workerColor?: string;
}

/** World independent work done once for every island of the replay (the island cache stays off). */
const loadViewerServices = async (params: AppParams, loading: ReturnType<typeof createLoadingScreen>) => {
  const choice = await chooseGraphics(params.quality, () => void loading.setStep("Checking graphics..."));
  await loading.setStep("Opening the scene replay...");
  const pool = createWorkerPool(workerPoolSize(), await openIslandCache(false));
  const [assets, rendererModule] = await Promise.all([
    loadIslandAssets(pool, pool.generateFoliage(FOLIAGE_SEED)), loadRenderer()
  ]);
  const graphics = readGraphicsOptions(choice.detail, params.ground);
  return { assets, graphics, pool, rendererModule, shared: createSharedBuilders(pool) } satisfies ViewerServices;
};

const createRenderer = (services: ViewerServices, segment: SceneSegment, world: WorldData,
  canvas: HTMLCanvasElement, index: number) => {
  const { assets, graphics, pool, rendererModule, shared } = services;
  return rendererModule.create({
    animals: assets.animalModels, buildingNation: segment.nation,
    builders: createPoolBuilders(pool, shared, world, `scene replay ${index}`), canvas,
    flyerAtlas: assets.flyerAtlas, foliageAtlas: assets.foliageAtlas, groundShader: graphics.groundShader,
    materials: assets.materials, microDetail: assets.microDetail, quality: graphics.quality,
    resolution: graphics.resolution,
    rockTexture: assets.rockTexture, stress: null,
    workers: randomWorkerAppearances(START_WORKER_COUNT, segment.nation), world
  });
};

/** Frees the island's GPU memory at once instead of waiting for the context's collection. */
const disposeRenderer = (renderer: TerrainRenderer) => {
  renderer.dispose();
  renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
};

const nextCanvas = (current: HTMLCanvasElement | undefined) => {
  if (!current) return document.getElementById("view") as HTMLCanvasElement;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = HIDDEN_CANVAS_STYLE;
  current.after(canvas);
  return canvas;
};

const showCanvas = (previous: HTMLCanvasElement | undefined, canvas: HTMLCanvasElement) => {
  if (!previous || previous === canvas) return;
  previous.remove();
  canvas.id = "view";
  canvas.removeAttribute("style");
};

const sizedFrame = (frame: FrameState, size: ReplayIsland["size"]): FrameState =>
  ({ ...frame, camera: { ...frame.camera, viewportHeight: size.viewportHeight, viewportWidth: size.viewportWidth } });

const playbackMessage = (report: SceneReplay, island: string) => {
  const truncated = report.truncated ? "recording truncated · " : "";
  return `${island} · interpolated snapshot playback · ${truncated}simulation and saves disabled`;
};

/**
 * Isolated `?sceneReplay=1` viewer: builds each recorded island from its own start world and
 * switches islands in place (no page reload): the next island prepares on a hidden canvas while
 * the current one keeps playing, then the canvases swap and the old renderer is released.
 */
export const startSceneReplayViewer = async ({ position, report, segment }: SceneReplayBoot, params: AppParams) => {
  const loading = createLoadingScreen();
  const viewport = document.getElementById("viewport")!;
  viewport.inert = true;
  const services = await loadViewerServices(params, loading);
  const ui = createReplayPanel();
  const interpolate = createFrameInterpolator();
  let island: ReplayIsland | undefined;
  let request = 0;
  const show = async (index: number, start: number) => {
    const current = ++request;
    const entry = report.segments[index]!;
    ui.message(`Loading ${entry.island}…`);
    const packedWorld = await decompressSceneBytes(entry.world);
    const world = unpackSceneData(packedWorld) as WorldData;
    const canvas = nextCanvas(island?.canvas);
    const renderer = await createRenderer(services, entry, world, canvas, index);
    inheritSharedFields(entry.samples.map(sample => sample.frame));
    const player = createScenePlayer(report, index, start);
    const first = player.blend().from;
    if (!first) throw new Error("Replay segment contains no captured frames");
    const size = { viewportHeight: 0, viewportWidth: 0 };
    syncViewport(renderer, size, viewport, services.graphics.resolution);
    await renderer.prepareFrame?.(sizedFrame(restoreSceneFrame(first.frame), size));
    const scrub = createWorldScrubber(world, renderer, entry, packedWorld);
    if (current !== request) {
      canvas.remove();
      disposeRenderer(renderer);
      return;
    }
    const previous = island;
    ui.controls.replaceChildren();
    const updateControls = addPlaybackControls({ panel: ui.controls, player, report, segment: index,
      onIsland: choice => void show(choice, 0).catch(error => ui.message(String(error))) });
    island = { canvas, index, player, renderer, scrub, size, updateControls };
    showCanvas(previous?.canvas, canvas);
    if (previous) disposeRenderer(previous.renderer);
    ui.message(playbackMessage(report, entry.island));
  };
  const draw = (current: ReplayIsland, delta: number) => {
    current.player.advance(delta);
    const { from, to, weight } = current.player.blend();
    if (!from) return;
    const presentation = from.presentation;
    if (presentation && presentation.viewMode !== current.renderer.getViewMode())
      current.renderer.setViewMode(presentation.viewMode);
    if (presentation && presentation.workerColor !== current.workerColor) {
      current.workerColor = presentation.workerColor;
      current.renderer.setWorkerColor(presentation.workerColor);
    }
    current.scrub(from.worldRevision);
    syncViewport(current.renderer, current.size, viewport, services.graphics.resolution);
    current.renderer.render(sizedFrame(interpolate(restoreSceneFrame(from.frame), to && restoreSceneFrame(to.frame), weight), current.size));
    current.updateControls();
  };
  let continuing = -1;
  const continueOnNextIsland = (current: ReplayIsland) => {
    const next = nextSceneSegment(report, current.index);
    if (!current.player.state().finished || next === undefined || continuing === next) return;
    continuing = next;
    void show(next, 0).catch(error => ui.message(String(error)));
  };
  await show(segment, position);
  ui.show(true);
  loading.hide();
  if (import.meta.env.DEV) window.__islandReady = true;
  let last = performance.now();
  const frame = (now: number) => {
    const delta = Math.max(0, now - last) / 1000;
    last = now;
    if (island && !document.hidden) {
      draw(island, delta);
      continueOnNextIsland(island);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};
