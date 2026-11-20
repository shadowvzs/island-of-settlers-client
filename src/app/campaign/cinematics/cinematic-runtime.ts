/**
 * CIN3 wiring of the campaign cinematics on one island: the sequence player with its ports, cinematic mode (HUD
 * scope, input lock, camera snapshot, suspended views) and the React layer. The island runtime advances it from
 * the render loop's `beforeRender`, reads `frame()` into `FrameState.cinematic`, gates camera input and picking
 * with `locksInput()` and holds the simulation tick with `holdsWorld()`. CIN4: the simulation's saved cinematic
 * state decides which sequence plays (`cinematic-world-bridge.ts`).
 */
import type { I18n } from "@lingui/core";

import type { CameraState } from "../../../render-common/camera-state";
import type { CameraOrbit } from "../../../render-common/cinematic/cinematic-frame";
import type { TerrainRenderer } from "../../../render-common/renderer-contract";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import type { WorldData } from "../../../shared/world/world-data";
import { createHudScope } from "../../hud-scope/hud-scope";
import { dialogueMsPerChar, dialogueSpeedPreference } from "../../settings/dialogue-speed/preference";
import { createCinematicInputLock } from "./cinematic-input-lock";
import { type CinematicSuspendable,createCinematicMode } from "./cinematic-mode";
import { type CinematicWorldSimulation, createCinematicWorldBridge } from "./cinematic-world-bridge";
import type { CinematicEffectsPort, CinematicPlayerPorts } from "./ports";
import { createSequencePlayer } from "./sequence-player";
import { mountCinematicLayer } from "./ui/cinematic-layer";

/** Dev review only (`?cinematicTest=1` seeks replay a sequence from its start). */
export interface CinematicDevReview {
  /** Replaces the drawn pose as the first transition's start (the last frame drew a shot). */
  drawnOrbit: () => CameraOrbit | null;
  /** Lightning of replayed steps stays dark, so a seeked frame shows only strikes of its own moment. */
  effectsMuted: () => boolean;
}

/** The weather, time of day, sound and music hooks (CIN6); lightning goes to the renderer. */
export type CinematicRuntimeEffects = Omit<CinematicEffectsPort, "strikeLightning">;

export interface CinematicRuntimeOptions {
  camera: CameraState;
  devReview?: CinematicDevReview;
  effects?: CinematicRuntimeEffects;
  i18n: I18n;
  renderer: TerrainRenderer;
  /** The possessed/commander views, read when a sequence enters cinematic mode. */
  suspendables: () => readonly (CinematicSuspendable | undefined)[];
  viewport: HTMLElement;
  world: WorldData;
  /**
   * The island's simulation (CIN4): its saved cinematic state decides what plays and whether the world holds; the
   * player's world steps become its recorded commands. Absent: presentation-only (world steps are no-ops).
   */
  simulation?: () => CinematicWorldSimulation | undefined;
}
/** Campaign portraits resolve through the campaign repository (C-lane); until then the initials fallback shows. */
const NO_PORTRAITS = () => null;

/** Effects of replayed (seeked) review steps stay muted, so a seek shows only its own moment. */
const liveEffects = ({ devReview, effects, renderer }: CinematicRuntimeOptions): CinematicEffectsPort => {
  const live = () => !devReview?.effectsMuted();
  return {
    music: (trackId, fadeMs) => { if (live()) effects?.music?.(trackId, fadeMs); },
    sound: cueId => { if (live()) effects?.sound?.(cueId); },
    strikeLightning: (x, z) => { if (live()) renderer.strikeLightning?.(x, z); },
    timeOfDay: (hour, instant) => { if (live()) effects?.timeOfDay?.(hour, instant); },
    weather: (state, transitionMs) => { if (live()) effects?.weather?.(state, transitionMs); }
  };
};

export const createCinematicRuntime = (options: CinematicRuntimeOptions) => {
  const { camera, i18n, renderer, viewport, world } = options;
  const bridge = createCinematicWorldBridge(options.simulation ?? (() => undefined));
  const groundHeight = (x: number, z: number) => Math.max(world.seaLevel, sampleSmooth(world, world.heights, x, z));
  const ports: CinematicPlayerPorts = {
    effects: liveEffects(options),
    language: () => i18n.locale,
    // Cinematic mode is created below: it needs the input lock, whose keys drive this player.
    mode: { enter: () => mode.enter(), exit: () => mode.exit() },
    msPerChar: () => dialogueMsPerChar(dialogueSpeedPreference.getSnapshot()),
    view: { cellsX: world.cellsX, cellsZ: world.cellsZ, groundHeight,
      drawnOrbit: () => options.devReview?.drawnOrbit() ?? renderer.currentCameraPose?.()?.orbit ?? null },
    world: bridge.port
  };
  const player = createSequencePlayer(ports);
  const hud = createHudScope("cinematic", document.documentElement);
  const lock = createCinematicInputLock({ target: window, viewport, onAdvance: player.advance,
    onSkipPress: player.pressSkip });
  const mode = createCinematicMode({ camera, hud, lock, suspendables: options.suspendables, view: renderer });
  const host = document.createElement("div");
  host.className = "cinematic-layer-host";
  viewport.append(host);
  const unmount = mountCinematicLayer({ host, i18n, presentation: player.presentation, resolvePortrait: NO_PORTRAITS,
    onAdvance: () => { player.advance(); }, onSkipPress: player.pressSkip });

  return {
    active: player.active,
    dispose: () => {
      player.clear();
      mode.exit();
      lock.dispose();
      hud.dispose();
      unmount();
      host.remove();
    },
    /** The effects port as the steps see it (dev review hooks). */
    effects: ports.effects,
    frame: player.frame,
    groundHeight,
    /** Real time a held simulation sequence has played, in ticks (the world environment's hour change). */
    heldTicks: bridge.heldTicks,
    /** The simulation's held sequence, or a presentation-only player's own paused sequence (dev review). */
    holdsWorld: () => bridge.holds() || (!bridge.active() && player.holdsWorld()),
    locksInput: player.locksInput,
    player: player,
    update: (deltaSeconds: number) => {
      bridge.sync(player);
      player.update(deltaSeconds);
      bridge.track(deltaSeconds);
    }
  };
};

export type CinematicRuntime = ReturnType<typeof createCinematicRuntime>;
