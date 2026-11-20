import { fract } from "../../../shared/world/noise";
import type { PropMesh } from "../../props/mesh-builder";

/** Animation clips a critter species may offer (the index is the clip id in CritterFrame). */
export const CLIP = {
  idle: 0,
  move: 1,
  fast: 2,
  feed: 3,
  look: 4,
  rest: 5,
  fly: 6,
  air: 7,
  /** Flight from a threat: a gallop where the species has one (food critters). */
  run: 8,
  /** Killed: the pose blends from standing to fallen on the side (death progress 0..1). */
  dead: 9
} as const;
export type Clip = (typeof CLIP)[keyof typeof CLIP];
export const CLIP_COUNT = 10;

/**
 * A clip over a species' frames: a `cycle` loops through them by phase (gaits, flaps), a `pose`
 * blends from the first to the last by an amount 0..1 (head down, tip up, a fish's pitch).
 */
export interface CritterClip {
  frames: readonly number[];
  kind: "cycle" | "pose";
}

/**
 * One species' poses: every frame has the same vertices (the renderer morphs between two of
 * them on the GPU), and the clips that play them.
 */
export interface CritterModel {
  clips: readonly (CritterClip | undefined)[];
  frames: readonly PropMesh[];
}

/** Two frames and the blend between them (scratch result of resolveClipFrames). */
export interface FramePair {
  blend: number;
  from: number;
  to: number;
}

export const createFramePair = (): FramePair => ({ blend: 0, from: 0, to: 0 });

/** The frames to show for `clip` at `phase` (cycle: 0..1 loops; pose: 0..1 amount). */
export const resolveClipFrames = (
  model: CritterModel,
  clip: number,
  phase: number,
  out: FramePair
) => {
  const chosen = model.clips[clip] ?? model.clips[CLIP.idle]!;
  const { frames } = chosen;
  const count = frames.length;
  if (chosen.kind === "cycle") {
    const position = fract(phase) * count;
    const index = Math.floor(position) % count;
    out.from = frames[index]!;
    out.to = frames[(index + 1) % count]!;
    out.blend = position - Math.floor(position);
    return out;
  }
  const position = Math.min(1, Math.max(0, phase)) * (count - 1);
  const index = Math.min(count - 2, Math.floor(position));
  out.from = frames[Math.max(0, index)]!;
  out.to = frames[Math.min(count - 1, index + 1)]!;
  out.blend = count === 1 ? 0 : position - index;
  return out;
};

/** Shorthands for species clip tables. */
export const cycle = (...frames: number[]): CritterClip => ({ frames, kind: "cycle" });
export const pose = (...frames: number[]): CritterClip => ({ frames, kind: "pose" });

/** A clip table from a partial map (missing clips fall back to idle). */
export const createClips = (clips: Partial<Record<Clip, CritterClip>>) => {
  const table: (CritterClip | undefined)[] = new Array(CLIP_COUNT).fill(undefined);
  for (const [clip, value] of Object.entries(clips)) table[Number(clip)] = value;
  return table;
};
