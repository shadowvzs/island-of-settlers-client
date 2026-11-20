/**
 * EXPLORE-01G coordinator wiring. This is the only place that connects the presentation-only
 * exploration controller to the live settlement, camera, renderer, world and UI. It intentionally
 * passes read-only queries and adapters; the controller never receives the simulation, SaveStore or
 * command dispatcher.
 */
import type { I18n } from "@lingui/core";
import { Group } from "three";

import type { CameraState } from "../../render-common/camera-state";
import type { ExplorationFrame as RenderExplorationFrame } from "../../render-common/exploration/exploration-frame";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import {
  createExplorationAppearanceAdapter,
  createExplorationSmokeAdapter,
  type ExplorationBodyLoader
} from "../../renderers/three/exploration";
import { createExplorationFogAdapter } from "../../renderers/three/exploration-fog";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { selectedExplorationPortrait } from "../player-avatar/store";
import { possessedActionForCode } from "../settings/hotkeys/bindings";
import {
  createExplorationCameraBoundary,
  type ExplorationCameraBoundary,
  type ExplorationHost,
  type ExplorationSessionIdentity,
  type ExplorationWeatherAdapter,
  type HomeExplorationContext
} from "./contracts";
import { createExplorationGroundQuery } from "./ground";
import { createExplorationInputGate } from "./input";
import {
  createExplorationController,
  type ExplorationRuntimeController
} from "./session";
import {
  createExplorationUiAdapter,
  type ExplorationUiAdapterHandle
} from "./ui";

interface IslandExplorationOptions {
  camera: CameraState;
  editorVisible: () => boolean;
  explorationFog: ReturnType<typeof createExplorationFogAdapter>;
  gate?: ReturnType<typeof createExplorationInputGate>;
  i18n: I18n;
  isHome: () => boolean;
  rain: () => number;
  renderer: TerrainRenderer;
  simulation: SettlementSimulation;
  viewport: HTMLElement;
  /** Closes ordinary panels/windows once entry is accepted; map drafts are not cancelled. */
  closeWindows?: () => void;
  world: WorldData;
  activeExpedition: () => { adventure: number | null; colony: number | null };
}

export interface IslandExploration {
  controller: ExplorationRuntimeController;
  controllerInputEnabled: () => boolean;
  dispose: () => void;
  frame: () => RenderExplorationFrame | undefined;
  gate: ReturnType<typeof createExplorationInputGate>;
  /** CIN3: a campaign cinematic suspends (true) or resumes the possessed view; it is never left for it. */
  setSuspended: (suspended: boolean) => void;
  update: (deltaSeconds: number) => RenderExplorationFrame | undefined;
  ui: ExplorationUiAdapterHandle;
}

const NO_WEATHER: ExplorationWeatherAdapter = {
  dispose: () => undefined,
  setActive: () => undefined,
  update: () => undefined
};

/**
 * Creates the live exploration session for the home island. It is deliberately not created for a
 * colony/adventure, editor or non-settlement page; the controller rechecks eligibility before entry.
 */
export const createIslandExploration = (options: IslandExplorationOptions): IslandExploration => {
  const { camera, explorationFog, i18n, renderer, simulation, viewport, world } = options;
  const appearanceRoot = new Group();
  appearanceRoot.name = "exploration-appearance";
  const smokeRoot = new Group();
  smokeRoot.name = "exploration-smoke";
  const removeAppearanceRoot = renderer.addTransient?.(appearanceRoot) ?? (() => undefined);
  const removeSmokeRoot = renderer.addTransient?.(smokeRoot) ?? (() => undefined);
  const loader = renderer.createExplorationBodyLoader?.() as ExplorationBodyLoader | undefined;
  if (!loader) throw new Error("The renderer does not expose a shared exploration body loader");
  let controller!: ExplorationRuntimeController;
  const appearance = createExplorationAppearanceAdapter({
    groundHeight: (x, z) => renderer.bridgeHeight?.(x, z) ?? sampleSmooth(world, world.heights, x, z),
    loader,
    onRefreshError: error => {
      console.warn("Exploration appearance could not be refreshed after the crowd changed", error);
      // The old body belongs to a disposed crowd: leave rather than keep a stale portrait alive.
      const phase = controller.phase();
      if (phase !== "idle" && phase !== "cooldown" && phase !== "disposed")
        controller.forceExit("renderer-failure");
    },
    parent: appearanceRoot,
    // The loader follows the current crowd; the simulation is the authoritative fallback for the
    // first entry and direct play. Both are read when the body is acquired, never captured at startup.
    portrait: () => {
      const nation = loader.nation?.() ?? simulation.playerNation();
      return selectedExplorationPortrait(nation);
    }
  });
  const smoke = createExplorationSmokeAdapter({ now: () => performance.now(), parent: smokeRoot });
  const bridgeHeight = (x: number, z: number) => renderer.bridgeHeight?.(x, z);
  const ground = createExplorationGroundQuery(world, simulation, bridgeHeight);
  ground.ceilingHeight = renderer.explorationCeilingHeight?.bind(renderer);
  const baseCamera: ExplorationCameraBoundary = createExplorationCameraBoundary(camera);
  const cameraBoundary: ExplorationCameraBoundary = {
    ...baseCamera,
    // The live RTS camera is the one save capture, wildlife and bookmarks use; the boundary only owns
    // the transient render frame.
    gameplayCamera: () => ({ ...camera }),
    savedRts: () => ({ ...camera })
  };
  const gate = options.gate ?? createExplorationInputGate();
  const normalInputAvailable = () => {
    const normalized = gate.snapshot().normalized;
    return !normalized.editorGesture && normalized.gesture === "none" &&
      !normalized.mapPointerActive && !normalized.modalOpen && !normalized.placementGesture;
  };
  let suppressWasActive = false;
  const clearNormalFeedback = () => {
    const canvas = document.querySelector<HTMLCanvasElement>("#view");
    canvas?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    viewport.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  };
  const blockPointer = (event: Event) => {
    if (gate.hooks.pickingAllowed()) return;
    const target = event.target as Element | null;
    if (target?.closest?.(".app-notification-host")) return;
    const inside = event.composedPath().some(node => node instanceof Element &&
      (node.matches(".exploration-ui") || Boolean(node.closest(".exploration-ui"))));
    if (inside || target?.closest?.(".exploration-ui")) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const blockKey = (event: KeyboardEvent) => {
    if (gate.hooks.shortcutAllowed()) return;
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.matches("input, textarea, select, [contenteditable='true']")) return;
    if (possessedActionForCode(event.code) || event.key === "Shift") return;
    event.preventDefault();
    event.stopPropagation();
  };
  const pointerEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "click",
    "dblclick", "contextmenu", "wheel"] as const;
  for (const type of pointerEvents) window.addEventListener(type, blockPointer, true);
  window.addEventListener("keydown", blockKey, true);
  const unsubscribeGate = gate.subscribe(() => {
    const active = !gate.hooks.pickingAllowed();
    if (active && !suppressWasActive) clearNormalFeedback();
    suppressWasActive = active;
  });
  const onVisibilityChange = () => {
    if (!document.hidden) return;
    controller.clearInputs();
    // A suspended view waits for the cinematic, which resumes where it was when the tab returns.
    if (controller.suspended()) return;
    if (controller.phase() !== "idle" && controller.phase() !== "disposed")
      controller.forceExit("background");
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const ui = createExplorationUiAdapter({
    actions: {
      onEnter: () => controller.enter(),
      onEscape: () => controller.escape(),
      onLeave: () => controller.requestLeave("leave"),
      onLook: (yaw, pitch) => controller.setLook(yaw, pitch),
      onMovement: (forward, right) => controller.setMovement(forward, right),
      onJump: () => controller.jump(),
      onSpyglass: () => controller.toggleSpyglass(),
      onSpyglassZoom: direction => controller.adjustSpyglassZoom(direction)
    },
    gate,
    i18n,
    mount: viewport
  });
  const identity = (): ExplorationSessionIdentity => ({
    accountId: null,
    generation: 1,
    islandKey: options.isHome() ? "home" : null,
    slotId: null
  });
  const landmarks = () => simulation.buildings()
    .filter(building => isOwnBuilding(building) && (building.typeId === 0 || building.typeId === 39))
    .map(building => ({ x: building.x, z: building.z }));
  const homeContext = (): HomeExplorationContext => {
    const active = options.activeExpedition();
    return {
      activeAdventure: active.adventure,
      activeColony: active.colony,
      editor: options.editorVisible(),
      homeIsland: options.isHome(),
      playback: false,
      sandbox: false,
      settlement: true
    };
  };
  const host: ExplorationHost = {
    appearance: {
      ...appearance,
      acquire: async identity => {
        const lease = await appearance.acquire(identity);
        try {
          const release = await renderer.prepareExplorationView?.();
          return { ...lease, dispose: () => { release?.(); lease.dispose(); } };
        } catch (error) { lease.dispose(); throw error; }
      }
    },
    camera: cameraBoundary,
    ground,
    identity,
    now: () => performance.now(),
    smoke,
    ui,
    visibility: explorationFog,
    // The renderer owns the weather adapter and reads frame.exploration.weather directly; the
    // controller only carries the transient weather frame. Keeping a second adapter here would
    // advance the same presentation twice per frame.
    weather: NO_WEATHER
  };
  controller = createExplorationController(host, {
    // The existing generic temporary explorer represents Scout capabilities, not a possessed army unit.
    actorType: () => "Scout",
    context: () => ({ home: homeContext(), inputAvailable: normalInputAvailable() }),
    focus: () => ({ x: camera.centerX, z: camera.centerZ }),
    onEntryStarting: options.closeWindows,
    landmarks,
    rain: options.rain
  });
  ui.publish(controller.snapshot());
  if (typeof window !== "undefined") {
    (window as Window & { __exploration?: unknown }).__exploration = {
      camera: cameraBoundary,
      controller,
      ui: { gate, hudScope: ui.hudScope, input: ui.input }
    };
  }
  let disposed = false;
  const frame = (): RenderExplorationFrame | undefined => {
    if (disposed) return undefined;
    const current = controller.frame();
    return current.camera || current.bubble || current.appearance || current.smoke || current.weather
      ? current : undefined;
  };
  return {
    controller,
    controllerInputEnabled: () => {
      const phase = controller.phase();
      return phase === "idle" || phase === "cooldown" || phase === "disposed";
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const type of pointerEvents) window.removeEventListener(type, blockPointer, true);
      window.removeEventListener("keydown", blockKey, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribeGate();
      controller.dispose();
      ui.dispose();
      appearance.dispose();
      smoke.dispose();
      removeAppearanceRoot();
      removeSmokeRoot();
    },
    frame,
    gate,
    setSuspended: suspended => {
      if (disposed) return;
      ui.input?.setSuspended(suspended);
      controller.setSuspended(suspended);
    },
    ui: ui as ExplorationUiAdapterHandle,
    update: (deltaSeconds) => {
      if (disposed) return undefined;
      ui.input?.update(deltaSeconds);
      const current = controller.update(deltaSeconds);
      return current.camera || current.bubble || current.appearance || current.smoke || current.weather
        ? current : undefined;
    }
  };
};
