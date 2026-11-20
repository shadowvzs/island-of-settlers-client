import type { MapRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type {
  CameraShot, CampaignSpeaker, CinematicStep, CinematicWeatherState
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { CameraOrbit } from "../../../render-common/cinematic/cinematic-frame";

/** The map data a sequence references by id (CIN0 regions, CIN1 shots and speakers). */
export interface CinematicSequenceContext {
  regions: readonly MapRegion[];
  shots: readonly CameraShot[];
  speakers: readonly CampaignSpeaker[];
}

/**
 * World steps (spawn, walk, face) and the end of a sequence. CIN4 implements this with the recorded
 * `applyCinematicStep` / `endCinematic` commands (`cinematic-world-bridge.ts`); presentation-only players (dev
 * review, editor preview) inject a no-op sender.
 */
export interface CinematicWorldPort {
  applyStep: (sequenceId: string, step: CinematicStep) => void;
  /**
   * Weather and time-of-day steps change the simulation on an island whose script owns a world environment (ENV0):
   * they go to `applyStep` instead of the effects port. Absent: always presentation.
   */
  ownsStep?: (step: CinematicStep) => boolean;
  /** `skipped`: every world step not applied yet is applied now, in order (the skip guarantee). */
  endSequence: (sequenceId: string, skipped: boolean) => void;
}

/** Presentation effects. Lightning is live (CIN2); weather, time, sound and music are CIN6 hooks. */
export interface CinematicEffectsPort {
  music?: (trackId: string | null, fadeMs: number) => void;
  sound?: (cueId: string) => void;
  strikeLightning: (x: number, z: number) => void;
  /** `instant` when a skip jumps to the end state. */
  timeOfDay?: (hour: number, instant: boolean) => void;
  weather?: (state: CinematicWeatherState, transitionMs: number) => void;
}

/** Cinematic mode: snapshot + suspend + HUD hide + input lock on enter, the exact restore on exit. */
export interface CinematicModePort {
  enter: () => void;
  exit: () => void;
}

/** What the director reads from the view (never the RTS camera itself). */
export interface CinematicViewPort {
  cellsX: number;
  cellsZ: number;
  /** The orbit form of the pose drawn last frame (the first transition starts there). */
  drawnOrbit: () => CameraOrbit | null;
  /** Camera ground (sea level over water). */
  groundHeight: (x: number, z: number) => number;
}

export interface CinematicPlayerPorts {
  effects: CinematicEffectsPort;
  /** The displayed language (speak text and its reading time). */
  language: () => string;
  mode: CinematicModePort;
  /** The dialogue-speed setting (ms per character). */
  msPerChar: () => number;
  view: CinematicViewPort;
  world: CinematicWorldPort;
}
