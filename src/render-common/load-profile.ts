/**
 * Lightweight load profiling: every setup stage is wrapped in performance.mark / measure (visible
 * in the DevTools Performance panel) and collected here; `?profile=1` logs one compact table
 * when the island is ready. Renderers and workers report through the same functions, so the
 * table covers generation, content workers and the renderer build sub-steps.
 */

import type { TerrainRenderer } from "./renderer-contract";

export interface LoadStage {
  name: string;
  /** Start relative to navigation start (ms). */
  start: number;
  duration: number;
}

const PREFIX = "load:";
const stages: LoadStage[] = [];

/** Records a stage measured elsewhere (a worker reports its own duration). */
export const recordStage = (name: string, start: number, duration: number) => {
  stages.push({ duration, name, start });
};

const begin = (name: string) => {
  performance.mark(`${PREFIX}${name}:start`);
  return performance.now();
};

const end = (name: string, start: number) => {
  const measure = performance.measure(`${PREFIX}${name}`, `${PREFIX}${name}:start`);
  recordStage(name, start, measure.duration);
};

/** Times one synchronous setup step. */
export const profileStep = <T>(name: string, step: () => T): T => {
  const start = begin(name);
  try {
    return step();
  } finally {
    end(name, start);
  }
};

/** Times one asynchronous setup step (its wall time, other work may overlap). */
export const profileAsync = async <T>(name: string, step: () => Promise<T>): Promise<T> => {
  const start = begin(name);
  try {
    return await step();
  } finally {
    end(name, start);
  }
};

export const getLoadStages = (): readonly LoadStage[] => stages;

/** Starts a fresh per-island load profile; repeated handoffs must not accumulate stage history. */
export const clearLoadProfile = () => {
  stages.length = 0;
};

const formatRow = ({ duration, name, start }: LoadStage) => ({
  stage: name,
  "start ms": Math.round(start),
  ms: Math.round(duration * 10) / 10
});

/** Logs the stage table once (only with ?profile=1); also exposed for the bench tools. */
export const reportLoadProfile = (enabled: boolean) => {
  recordStage("ready (navigation to first frame)", 0, performance.now());
  if (import.meta.env.DEV) window.__loadProfile = stages.map(formatRow);
  if (!enabled) return;
  if (import.meta.env.DEV) console.table(window.__loadProfile);
};

declare global {
  interface Window {
    /** Load stages of the current island (bench tools, ?profile=1). */
    __loadProfile?: ReturnType<typeof formatRow>[];
  }
}

/** Wraps a renderer's render so its first call (shader compile, uploads) is a load stage. */
export const profileFirstFrame = (renderer: TerrainRenderer, onDone: () => void) => {
  const render = renderer.render;
  renderer.render = (frame) => {
    renderer.render = render;
    profileStep("first frame (shader compile, uploads)", () => render(frame));
    onDone();
  };
};
