import type { AdventureCampFrame } from "../render-common/adventure/adventure-camp";
import type { BirdFrame } from "../render-common/birds/bird-pool";
import type { BuildingFrame } from "../render-common/buildings/building-catalog";
import type { ButterflyFrame } from "../render-common/butterflies/butterfly-pool";
import { createCameraController } from "../render-common/camera-controller";
import type { CameraState } from "../render-common/camera-state";
import type { CinematicFrame } from "../render-common/cinematic/cinematic-frame";
import type { CritterFrame } from "../render-common/critters/sim/critter-pool";
import type { EnvironmentState } from "../render-common/environment";
import type { ExplorationFrame } from "../render-common/exploration/exploration-frame";
import type { FellingFrame } from "../render-common/felling/felling-simulation";
import { markFrameStage, startFrameProfiler, stopFrameProfiler } from "../render-common/frame-profiler";
import {
  createFrameStats,
  type FrameSummary,
  instrumentDrawCalls} from "../render-common/frame-stats";
import { createGpuTimer } from "../render-common/gpu-timer";
import type { GrowthFrame } from "../render-common/growth/tree-growth";
import type { HandcartFrame } from "../render-common/logistics/handcart-frame";
import type { MountFrame } from "../render-common/mounts/mount-frame";
import { createPresentationScheduler, type PresentationScheduler } from "../render-common/presentation-scheduler";
import type {
  FrameState, PlacementGhostFrame, PlacementPreviewFrame, RallyBannerFrame, TerrainRenderer
} from "../render-common/renderer-contract";
import {
  getPixelRatio,
  type ResolutionProfile,
  type ResolutionState
} from "../render-common/resolution";
import type { MilitaryDeathFrame } from "../render-common/settlement/death-smoke";
import type { FishingBoatFrame, ShipFrame, ShipSiteFrame, ShuttleBoatFrame } from "../render-common/ships/ship-frame";
import type { StressEntities } from "../render-common/stress/stress-world";
import type { AnimalFrame } from "../render-common/wildlife/sim/animal-pool";
import type { WorkerFrame } from "../render-common/workers/worker-unit";
import type { MilitaryArrow } from "../shared/settlement/military-projectiles";
import type { RoadSegment } from "../shared/settlement/road-types";
import type { SettlementFieldFrame } from "../shared/settlement/settlement-field-cycles";
import type { TransportHorseFrame } from "../shared/settlement/settlement-horses";
import type { TerritoryBorderPoint } from "../shared/settlement/settlement-territory";
import type { WorldData } from "../shared/world/world-data";
import { createFrameErrorGuard } from "./frame-error-guard";
import type { SceneReplayRuntime } from "./scene-replay/runtime";
import { cameraRotateTurn } from "./settings/hotkeys/bindings";
import { mouseRotationPreference } from "./settings/mouse-rotation/preference";

const STATS_INTERVAL_MS = 500;
/** Target frame budget for presentation leftovers (60 fps). */
const FRAME_BUDGET_MS = 1000 / 60;
const PRESENTATION_MIN_MS = 0.5;
const PRESENTATION_MAX_MS = 4;

/** R09/C13 budget controller seam: presentation only, it never sees or advances the simulation. */
export interface RenderLoopBudget {
  /** Every animation-frame callback asks once; false skips drawing it (frame-rate limit). */
  frameDue(now: number): boolean;
  recordFrame(now: number, intervalMs: number, cpuMs: number): void;
  recordGpu(now: number, milliseconds: number): void;
  /** The drawing buffer was resized; its reallocation hitch is not a budget sample. */
  resized(now: number): void;
  /** The tab became visible again: the next callbacks start fresh intervals. */
  resume(now: number): void;
}

interface LoopOptions {
  budget?: RenderLoopBudget;
  sceneReplay?: SceneReplayRuntime;
  onReady?: () => void;
  onError?: (error: unknown) => void;
  /** Receives the canvas in the drawn frame's task, before the WebGL drawing buffer is cleared. */
  onScreenshot?: (canvas: HTMLCanvasElement) => void;
  beforeRender?: (delta: number) => void;
  afterRender?: (delta: number) => void;
  updateSettlement?: (delta: number, time: number) => {
    cavalryMounts?: readonly MountFrame[];
    buildings: readonly BuildingFrame[];
    militaryArrows?: readonly MilitaryArrow[];
    militaryDeaths?: readonly MilitaryDeathFrame[];
    rallyBanner?: RallyBannerFrame | null;
    roads: RoadSegment[];
    roadRevision: number;
    territoryBorders?: readonly TerritoryBorderPoint[];
    territoryRevision?: number;
    roadPreview?: import("../shared/settlement/road-types").RoadPreview | null;
    placementGhost?: PlacementGhostFrame | null;
    fields?: readonly SettlementFieldFrame[];
    marbleDeposits?: readonly import("../shared/settlement/colony-marble-deposits").MarbleDeposit[];
    adventureCamps?: readonly AdventureCampFrame[];
    ships?: readonly ShipFrame[];
    shipPreviewWorkers?: readonly WorkerFrame[];
    shipSites?: readonly ShipSiteFrame[];
    shuttleBoats?: readonly ShuttleBoatFrame[];
    fishingBoats?: readonly FishingBoatFrame[];
    transportHorses?: readonly TransportHorseFrame[];
    handcarts?: readonly HandcartFrame[];
  };
  /** The fit markers of the building being placed (null: none). */
  getPlacementPreviews?: () => PlacementPreviewFrame | null;
  /** Advances the player's workers by `delta` seconds. */
  updateWorkers?: (delta: number) => readonly WorkerFrame[];
  /** Advances the horses with riders by `delta` seconds (the `?horse=1` dev trial). */
  updateMounts?: (delta: number) => readonly MountFrame[];
  camera: CameraState;
  /** False while exploration owns the camera/pointer; normal pan, pinch and edge scrolling pause. */
  cameraInputEnabled?: () => boolean;
  /** The current transient exploration frame (absent in ordinary play). */
  getExplorationFrame?: () => ExplorationFrame | undefined;
  /** CIN2: the current campaign cinematic overrides (absent in ordinary play). */
  getCinematicFrame?: () => CinematicFrame | undefined;
  /** The map canvas inside `viewport` (touches on it pinch-zoom). */
  canvas: HTMLCanvasElement;
  /** Advances time of day and weather; returns this frame's environment. */
  updateEnvironment: (deltaSeconds: number) => EnvironmentState;
  /** Advances tree felling and falling leaves to `time` (seconds since start). */
  updateFelling: (time: number) => FellingFrame;
  /** Advances tree growth to `time` (seconds since start). */
  updateGrowth: (time: number) => GrowthFrame;
  /** Advances the wandering animals to `time` around the camera. */
  updateAnimals: (time: number, camera: CameraState) => AnimalFrame;
  /** Advances the ambient birds to `time` around the camera in this frame's environment. */
  updateBirds: (time: number, camera: CameraState, environment: EnvironmentState) => BirdFrame;
  /** Advances the butterflies near the camera to `time` in this frame's environment. */
  updateButterflies: (
    time: number,
    camera: CameraState,
    environment: EnvironmentState
  ) => ButterflyFrame;
  /** Advances the decorative critters near the camera to `time` in this frame's environment. */
  updateCritters: (
    time: number,
    camera: CameraState,
    environment: EnvironmentState
  ) => CritterFrame;
  onStats: (summary: FrameSummary) => void;
  /** R01 dev flag (`?passes=1`): per stage/pass CPU, GPU, draw calls and triangles. */
  passProfile?: boolean;
  /** The live Resolution profile; applying one bumps `revision` to force a resize. */
  resolution: ResolutionState;
  stress: StressEntities | null;
  renderer: TerrainRenderer;
  /** Optional presentation scheduler (tests/prewarm tools); the loop creates one when absent. */
  presentation?: PresentationScheduler;
  viewport: HTMLElement;
  world: WorldData;
}

/**
 * Resizes the renderer when the viewport changed; `camera` keeps the last size. `force` resizes
 * even when the CSS dimensions match (a live pixel-ratio change).
 */
export const syncViewport = (
  renderer: TerrainRenderer,
  camera: Pick<CameraState, "viewportHeight" | "viewportWidth">,
  viewport: HTMLElement,
  resolution: ResolutionProfile,
  force = false,
  renderScale = 1
) => {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!force && width === camera.viewportWidth && height === camera.viewportHeight) return false;
  camera.viewportWidth = width;
  camera.viewportHeight = height;
  renderer.resize(width, height, getPixelRatio(window.devicePixelRatio, resolution, renderScale));
  return true;
};

/** requestAnimationFrame loop: input, render, statistics. */
export const startRenderLoop = (options: LoopOptions) => {
  const { camera, canvas, renderer, viewport, world } = options;
  const controller = createCameraController({
    camera,
    cellsX: world.cellsX,
    cellsZ: world.cellsZ,
    element: viewport,
    enabled: options.cameraInputEnabled,
    mouseRotation: mouseRotationPreference.getSnapshot,
    rotateKeyTurn: code => cameraRotateTurn(code),
    surface: canvas
  });
  const counter = instrumentDrawCalls(renderer.gl);
  const stats = createFrameStats(counter);
  const gpuTimer = createGpuTimer(renderer.gl);
  const presentation = options.presentation ?? createPresentationScheduler();
  // Pass queries replace the whole-frame query: WebGL2 cannot nest TIME_ELAPSED queries.
  const profiler = options.passProfile ? startFrameProfiler(renderer.gl, counter) : null;
  // A lost context (GPU process reset, driver timeout) freezes the view until the browser restores it.
  const logContext = (event: Event) => console.warn(`WebGL ${event.type}`);
  renderer.gl.canvas.addEventListener("webglcontextlost", logContext);
  renderer.gl.canvas.addEventListener("webglcontextrestored", logContext);
  let startedAt = performance.now();
  let lastFrame = startedAt;
  let lastStats = startedAt;
  let running = true;
  let prepared = !renderer.prepareFrame;
  let screenshotRequested = false;
  /** ResizeObserver marks the viewport dirty, so a settled window costs no per-frame layout read. */
  let viewportDirty = true;
  let resolutionRevision = options.resolution.revision;
  const markViewportDirty = () => { viewportDirty = true; };
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(markViewportDirty);
  resizeObserver?.observe(viewport);
  if (typeof window !== "undefined" && "addEventListener" in window)
    window.addEventListener("resize", markViewportDirty);

  const guard = createFrameErrorGuard();
  /** One frame; false when the frame itself schedules the next one (first-frame preparation). */
  let hiddenSinceLastFrame = false;
  const drawFrame = (now: number) => {
    if (document.hidden) {
      hiddenSinceLastFrame = true;
      return true;
    }
    if (hiddenSinceLastFrame) {
      hiddenSinceLastFrame = false;
      options.budget?.resume(now);
    }
    if (prepared && options.budget && !options.budget.frameDue(now)) return true;
    /** The first frame's timestamp can predate `startedAt` (frame began before setup ended). */
    const interval = Math.max(0, now - lastFrame);
    lastFrame = Math.max(lastFrame, now);
    const elapsed = Math.max(0, now - startedAt) / 1000;
    const resolutionChanged = options.resolution.revision !== resolutionRevision;
    // Without ResizeObserver (older embeds/tests) keep the previous per-frame check.
    if (viewportDirty || !resizeObserver || resolutionChanged) {
      viewportDirty = false;
      resolutionRevision = options.resolution.revision;
      // A newly applied profile resizes even when the CSS viewport size did not change.
      const { profile, renderScale } = options.resolution;
      if (syncViewport(renderer, camera, viewport, profile, resolutionChanged, renderScale))
        options.budget?.resized(now);
    }
    if (options.cameraInputEnabled?.() !== false) controller.update(interval / 1000);
    options.stress?.update(interval / 1000, elapsed);
    stats.beginFrame();
    profiler?.beginFrame();
    const cpuStart = performance.now();
    const drawn: FrameState = (() => {
      markFrameStage("loop.environment");
      const environment = options.updateEnvironment(interval / 1000);
      markFrameStage("loop.settlement");
      const settlement = options.updateSettlement?.(interval / 1000, elapsed);
      markFrameStage("loop.workersMounts");
      const workers = options.updateWorkers?.(interval / 1000);
      const mounts = options.updateMounts?.(interval / 1000);
      markFrameStage("loop.beforeRender");
      options.beforeRender?.(interval / 1000);
      markFrameStage("loop.ambient");
      const felling = options.updateFelling(elapsed);
      const growth = options.updateGrowth(elapsed);
      const birds = options.updateBirds(elapsed, camera, environment);
      const butterflies = options.updateButterflies(elapsed, camera, environment);
      const animals = options.updateAnimals(elapsed, camera);
      const critters = options.updateCritters(elapsed, camera, environment);
      return {
        ...settlement,
        placementPreviews: options.getPlacementPreviews?.(),
        animals,
        birds,
        butterflies,
        camera,
        cinematic: options.getCinematicFrame?.(),
        critters,
        environment,
        exploration: options.getExplorationFrame?.(),
        felling,
        growth,
        mounts,
        time: elapsed,
        workers
      } satisfies FrameState;
    })();
    drawn.camera = { ...drawn.camera, viewportWidth: camera.viewportWidth, viewportHeight: camera.viewportHeight };
    if (!prepared) {
      prepared = true;
      void renderer.prepareFrame!(drawn).then(() => {
        startedAt = performance.now(); lastFrame = startedAt; lastStats = startedAt;
        options.onReady?.();
        requestAnimationFrame(frame);
      }).catch(error => { running = false; options.onError?.(error); });
      return false;
    }
    if (!profiler) gpuTimer?.begin();
    // A throwing render must still close the GPU query, or every later begin fails.
    try {
      options.sceneReplay?.capture(drawn);
      renderer.render(drawn);
      if (screenshotRequested) {
        screenshotRequested = false;
        options.onScreenshot?.(canvas);
      }
      markFrameStage("loop.afterRender");
      options.afterRender?.(interval / 1000);
    } finally {
      gpuTimer?.end();
      profiler?.endFrame();
    }
    const measuredMs = performance.now() - cpuStart;
    // Presentation work gets only the measured leftover of the frame budget, never the tick.
    presentation.runBudget(Math.min(PRESENTATION_MAX_MS,
      Math.max(PRESENTATION_MIN_MS, FRAME_BUDGET_MS - measuredMs)));
    const cpuMs = performance.now() - cpuStart;
    stats.endFrame(interval, cpuMs);
    // The controller judges the frame work itself, not the leftover filled by presentation work.
    options.budget?.recordFrame(now, interval, measuredMs);
    const recordGpu = (milliseconds: number) => {
      stats.recordGpu(milliseconds);
      options.budget?.recordGpu(now, milliseconds);
    };
    if (profiler) profiler.poll(recordGpu);
    else gpuTimer?.poll(recordGpu);
    if (now - lastStats > STATS_INTERVAL_MS) {
      lastStats = now;
      options.onStats(stats.summarize());
    }
    return true;
  };
  const frame = (now: number) => {
    if (!running) return;
    // One failing frame (a bad actor frame, a renderer error) must not stop every later frame.
    if (guard.run(drawFrame, now, true)) requestAnimationFrame(frame);
  };
  /** A retained tab resume already replayed the hidden interval: do not hand it to the frame clocks again. */
  const resetTime = () => {
    const now = performance.now();
    startedAt = now; lastFrame = now; lastStats = now;
  };
  if (prepared) options.onReady?.();
  requestAnimationFrame(frame);

  return {
    /** Captures the next drawn frame (the loop may be throttled or hidden for a while). */
    requestScreenshot: () => { screenshotRequested = true; },
    resetTime,
    stop: () => {
      running = false;
      resizeObserver?.disconnect();
      if (typeof window !== "undefined" && "removeEventListener" in window)
        window.removeEventListener("resize", markViewportDirty);
      controller.dispose();
      if (profiler) stopFrameProfiler();
      renderer.gl.canvas.removeEventListener("webglcontextlost", logContext);
      renderer.gl.canvas.removeEventListener("webglcontextrestored", logContext);
    }
  };
};
