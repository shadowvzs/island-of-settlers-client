/**
 * Development review hook (`?cinematicTest=1`, CIN2 -> CIN3): plays the owner's example sequence
 * (`fixture-sequence-data.ts`) through the real sequence player, cinematic mode, input lock and HUD scope, from the
 * player's current view (iso, perspective or possessed). `window.__cinematicTest` exposes play/seek/resume/stop for
 * captures; a seek replays the sequence from its start in fixed steps, so a seeked frame is deterministic. Never in
 * player builds (dynamic import behind `import.meta.env.DEV`).
 */
import type {
  CinematicWeatherState
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { MIN_PITCH } from "../../../render-common/camera-state";
import type { CameraOrbit, DrawnCameraPose } from "../../../render-common/cinematic/cinematic-frame";
import type { TerrainRenderer } from "../../../render-common/renderer-contract";
import type { CinematicRuntime } from "./cinematic-runtime";
import { MS_PER_SECOND } from "./constants";
import { createFixtureSequence } from "./fixture-sequence-data";
import { createStrikeFixture } from "./fixture-strike-data";

export interface CinematicTestOptions {
  renderer: TerrainRenderer;
  runtime: CinematicRuntime;
}

/** Seeks replay the sequence in steps of this many seconds (the player's own frame clamp is larger). */
const SEEK_STEP_SECONDS = 0.05;
/** A replayed strike younger than this still shows its bolt in the seeked frame. */
const SEEK_LIVE_EFFECTS_MS = 450;
/** A flat (possessed) view frames the fixture around the eye from this strategic orbit instead of its far focus. */
const EYE_ANCHOR = { distance: 80, pitch: (40 * Math.PI) / 180 } as const;

/** Review fixtures: the owner's example (CIN3) and the ground strike / glint review (CIN6). */
const FIXTURES = { owner: createFixtureSequence, strike: createStrikeFixture } as const;
type FixtureName = keyof typeof FIXTURES;

/** The fixture's anchor: the drawn orbit of a strategic view, or the ground under a possessed eye. */
const fixtureAnchor = (drawn: DrawnCameraPose, groundHeight: (x: number, z: number) => number): CameraOrbit => {
  if (drawn.orbit.pitch >= MIN_PITCH) return drawn.orbit;
  const { x, z } = drawn.eye;
  return { ...drawn.orbit, ...EYE_ANCHOR, targetX: x, targetY: groundHeight(x, z), targetZ: z };
};

export const createCinematicTestHook = ({ renderer, runtime }: CinematicTestOptions) => {
  const { player } = runtime;
  /** The seek session's view and fixture anchor: every seek starts the first transition there again. */
  let start: CameraOrbit | null = null;
  let startPose: DrawnCameraPose | null = null;
  let seeking = false;
  let paused = false;
  let muted = false;

  const drawnAnchor = () => {
    const drawn = renderer.currentCameraPose?.();
    return drawn ? fixtureAnchor(drawn, runtime.groundHeight) : null;
  };

  const play = (pauseWorld = true, name: FixtureName = "owner") => {
    const anchor = drawnAnchor();
    if (!anchor) return false;
    paused = false;
    const fixture = FIXTURES[name](anchor, runtime.groundHeight, pauseWorld);
    return player.play(fixture.sequence, fixture.context);
  };

  const stop = () => {
    player.clear();
    start = null;
    seeking = false;
    paused = false;
  };

  /** The first seek after a stop records the view; later seeks reuse it (the last frame drew a shot). */
  const seek = (timeMs: number, name: FixtureName = "owner") => {
    if (!start) {
      startPose = renderer.currentCameraPose?.() ?? null;
      start = startPose ? fixtureAnchor(startPose, runtime.groundHeight) : null;
    }
    if (!start || !startPose) return false;
    player.clear();
    seeking = true;
    const fixture = FIXTURES[name](start, runtime.groundHeight);
    player.play(fixture.sequence, fixture.context);
    for (let elapsed = 0; elapsed < timeMs && player.active(); elapsed += SEEK_STEP_SECONDS * MS_PER_SECOND) {
      muted = elapsed < timeMs - SEEK_LIVE_EFFECTS_MS;
      player.update(Math.min(SEEK_STEP_SECONDS, (timeMs - elapsed) / MS_PER_SECOND));
    }
    muted = false;
    paused = true;
    return true;
  };

  const api = {
    /** Click / Space on the shown line. */
    advance: player.advance,
    play,
    /** The pose drawn last frame and the GPU resource counters (review receipts). */
    pose: () => renderer.currentCameraPose?.() ?? null,
    pressSkip: player.pressSkip,
    resources: () => renderer.getResourceStats?.() ?? null,
    resume: () => { paused = false; },
    seek,
    state: () => ({ ...player.state(), active: player.active(), holdsWorld: player.holdsWorld(),
      locksInput: player.locksInput(), ui: player.presentation.ui.getSnapshot(),
      visual: player.presentation.visual.getSnapshot() }),
    stop,
    strike: (x: number, z: number) => renderer.strikeLightning?.(x, z),
    /** CIN6 environment hooks as a sequence step calls them (instant = a skipped step's end state). */
    timeOfDay: (hour: number, instant = false) => runtime.effects.timeOfDay?.(hour, instant),
    weather: (state: CinematicWeatherState, transitionMs: number) => runtime.effects.weather?.(state, transitionMs)
  };
  (window as Window & { __cinematicTest?: typeof api }).__cinematicTest = api;

  return {
    dispose: () => {
      stop();
      delete (window as Window & { __cinematicTest?: typeof api }).__cinematicTest;
    },
    /** While seeking, the first transition starts from the cached review start (the last frame drew a shot). */
    drawnOrbit: () => (seeking ? startPose?.orbit ?? null : null),
    effectsMuted: () => muted,
    /** The render loop's delta; a seeked (paused) review holds its frame. */
    update: (deltaSeconds: number) => {
      if (!player.active()) seeking = false;
      runtime.update(paused ? 0 : deltaSeconds);
    }
  };
};
