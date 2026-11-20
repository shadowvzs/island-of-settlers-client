import { readFileSync } from "node:fs";

import { type GameView } from "./reference-capture";
import { type Landward, type Roi } from "./reference-image";

/** What a tuner spec compares: shore swash (foam front, wet band) or clouds (drift, edges, rims). */
export type TunerKind = "clouds" | "swash";

/** Camera class from resources/references/owner-videos/SOURCES.md: motion metrics only for static and slow clips. */
export type CameraClass = "moving" | "slow" | "static";

export interface ReferenceClip {
  camera: CameraClass;
  /** Path relative to the videos folder (`--videos`). */
  clip: string;
  duration: number;
  /** Analysis frame rate. */
  fps: number;
  /** Horizontal field of view guess (degrees) for cloud angles; default 60. */
  hfov?: number;
  label: string;
  /** Screen side of the land (swash); default down. */
  landward?: Landward;
  /** Analysed region in shares of the frame; default the whole frame. */
  roi?: Roi;
  start: number;
}

export interface ReferenceStill {
  /** Path relative to the stills folder (`--stills`). */
  image: string;
  label: string;
  landward?: Landward;
  roi?: Roi;
}

export interface GameCapture {
  /** Possessed auto-exposure tuning overrides (EyeAdaptationTuning keys) for this capture. */
  exposure?: Record<string, number>;
  /** Draws per frame before the read (default 10, converged); 1–2 approximate live frames (flicker strips). */
  draws?: number;
  /** Analysis frame rate: the frozen clock steps 1 / fps seconds per frame (sky: at least 2). */
  fps: number;
  presets: string[];
  /** Suffix of the capture key, to tell two captures of one view apart (e.g. "flicker"). */
  name?: string;
  /** Analysed region; default the whole frame. */
  roi?: Roi;
  seconds: number;
  /** `pinScene` names: day, dusk, dawn, night or an hour. */
  times: string[];
  view: GameView;
}

export interface TunerSpec {
  /** Pixels across the analysed frames (default 320). */
  analysisWidth: number;
  /** Possessed sky cloud cover pinned for the game captures (clouds only; default 0.55). */
  cover: number;
  game: GameCapture[];
  kind: TunerKind;
  name: string;
  references: ReferenceClip[];
  stills: ReferenceStill[];
}

export const loadTunerSpec = (file: string): TunerSpec => {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<TunerSpec>;
  if (!raw.name || !raw.kind) throw new Error(`${file}: "name" and "kind" are required`);
  return { analysisWidth: raw.analysisWidth ?? 320, cover: raw.cover ?? 0.55, game: raw.game ?? [], kind: raw.kind,
    name: raw.name, references: raw.references ?? [], stills: raw.stills ?? [] };
};

/** Folder/file key of one game capture. */
export const gameKey = (capture: GameCapture, preset: string, time: string) =>
  [preset, time, capture.view, capture.name].filter(Boolean).join("-");
