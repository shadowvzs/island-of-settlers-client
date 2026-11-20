import type { CinematicStep } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { CameraOrbit, CinematicPoint } from "../../../render-common/cinematic/cinematic-frame";
import type { CameraDirector } from "./camera-director";
import type { CinematicPlayerPorts } from "./ports";
import type { CinematicFadeColor, CinematicPresentation } from "./presentation";

/** The letterbox and fade amounts of the running sequence (pushed to the visual channel once per frame). */
export interface CinematicLook {
  fade: number;
  fadeColor: CinematicFadeColor;
  letterbox: number;
}

/** What a step runner may touch while its sequence plays. */
export interface CinematicRunContext {
  director: CameraDirector;
  language: string;
  /** The speak steps' index in the sequence's speak lines (the speaker panel's line list). */
  lineIndexOf: (stepId: string) => number;
  look: CinematicLook;
  /** Enter/leave cinematic mode once (snapshot, suspend, HUD, input lock / exact restore). */
  mode: { enter: () => void; exit: () => void };
  msPerChar: number;
  ports: CinematicPlayerPorts;
  presentation: CinematicPresentation;
  /** A step really took `durationMs` (a clicked-away line, an arrival): later steps re-anchor on it. */
  reanchor: (stepId: string, durationMs: number) => void;
  regionCells: (regionId: string) => Int32Array | null;
  regionPoint: (regionId: string) => CinematicPoint | null;
  sequenceId: string;
  setHighlight: (regionId: string, on: boolean) => void;
  shotOrbit: (shotId: string) => CameraOrbit | null;
}

/**
 * One step on the presentation clock. Times are sequence milliseconds; `begin` receives the step's scheduled start,
 * so a frame that overshoots the start still plays the step from its correct position.
 */
export interface StepRunner {
  /** Click / Space on a speak line. */
  advance?: (nowMs: number) => void;
  /** A walk step's actor arrived (its arrival event). */
  arrive?: (nowMs: number) => void;
  begin: (startMs: number) => void;
  /** Skip: put the step's end state in place now (`begun` false: the step never started). */
  finish: (begun: boolean) => void;
  /** True once the runner has nothing left to show (it may outlast its scheduled end, e.g. repeated strikes). */
  settled: (nowMs: number) => boolean;
  update: (nowMs: number) => void;
}

export type StepRunnerFactory<S extends CinematicStep = CinematicStep> =
  (step: S, context: CinematicRunContext) => StepRunner;
