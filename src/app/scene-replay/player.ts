import type { SceneReplay, SceneSample } from "./journal";

export const SCENE_REPLAY_SPEEDS = [.25, .5, 1, 2, 4] as const;

/** Index of the last sample at or before the time: binary search over the ordered capture times. */
const sampleIndexAt = (samples: readonly SceneSample[], time: number) => {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle]!.at <= time) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
};

/** The island segment that continues the recording after this one, if any. */
export const nextSceneSegment = (report: SceneReplay, segment: number) => {
  const next = segment + 1;
  if (!report.segments[next]?.samples.length) return undefined;
  return next;
};

/** Clock selects recorded frames; no random AI, economy tick or command execution. */
export const createScenePlayer = (report: SceneReplay, segment = 0, position = 0) => {
  let finished = false;
  let playing = true;
  let speed = 1;
  let time = position;
  const samples = report.segments[segment]?.samples ?? [];
  const duration = samples.at(-1)?.at ?? 0;
  return {
    advance: (delta: number): SceneSample | undefined => {
      if (playing) time = Math.min(duration, time + Math.max(0, delta) * speed);
      // Only playback running into the end finishes a segment; a paused seek to the end does not.
      if (playing && time >= duration) {
        playing = false;
        finished = true;
      }
      return samples[sampleIndexAt(samples, time)];
    },
    /** The snapshots around the clock and how far it is between them (0..1). */
    blend: () => {
      const index = sampleIndexAt(samples, time);
      const from = samples[index];
      const to = samples[index + 1];
      if (!from || !to || to.at <= from.at) return { from, to: undefined, weight: 0 };
      return { from, to, weight: Math.min(1, Math.max(0, (time - from.at) / (to.at - from.at))) };
    },
    seek: (value: number) => {
      if (!Number.isFinite(value)) return;
      time = Math.max(0, Math.min(duration, value));
      finished = false;
    },
    toggle: () => { playing = !playing; },
    setSpeed: (value: number) => {
      if ((SCENE_REPLAY_SPEEDS as readonly number[]).includes(value)) speed = value;
    },
    state: () => ({ duration, finished, playing, position: time, segment, speed })
  };
};
