import type { WebGPURenderer } from "three/webgpu";

/**
 * G-W5 evidence: counts the node builds, shader programs and render pipelines the backend creates,
 * split into the prewarm (behind the loading screen), synchronous builds after it (each one a hitch a
 * player sees) and builds of the async compiler (between frames, the object hidden meanwhile). Keeps
 * the CPU time of the first frames after the prewarm and the worst frame since. A steady state
 * compiles nothing synchronously. Wraps the backend instance's own factory methods only.
 */

const FIRST_FRAMES = 8;
const MAX_LATE_LABELS = 80;

export interface PipelineCounts {
  nodeBuilds: number;
  pipelines: number;
  programs: number;
}

export interface PipelineTrackerStats {
  /** Synchronous (in-frame) creations after the prewarm. */
  afterPrewarm: PipelineCounts;
  /** Creations of the async compiler after the prewarm (outside any frame). */
  async: PipelineCounts;
  asyncBuilds: string[];
  firstFrameMs: number[];
  /** What the late synchronous node builds (and `pipeline:` pipelines) were for: object and material. */
  lateBuilds: string[];
  prewarm: PipelineCounts;
  /** The worst frame CPU ms since the prewarm (first frames included). */
  worstFrameMs: number;
}

type BackendFactory = (...args: never[]) => unknown;

const emptyCounts = (): PipelineCounts => ({ nodeBuilds: 0, pipelines: 0, programs: 0 });

interface LabelledObject {
  material?: { name?: string; type?: string } | Array<{ name?: string; type?: string }>;
  name?: string;
  parent?: { name?: string } | null;
  type?: string;
}

const labelOf = (object: LabelledObject | undefined) => {
  if (object === undefined) return "?";
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  return `${object.type}:${object.name || object.parent?.name || "-"}:${material?.name || material?.type}`;
};

export const createPipelineTracker = (renderer: WebGPURenderer) => {
  const prewarm = emptyCounts();
  const afterPrewarm = emptyCounts();
  const asyncCounts = emptyCounts();
  const firstFrameMs: number[] = [];
  const lateBuilds: string[] = [];
  const asyncBuilds: string[] = [];
  let prewarmed = false;
  let asyncDepth = 0;
  let worstFrameMs = 0;

  const countsNow = () => {
    if (!prewarmed) return prewarm;
    return asyncDepth > 0 ? asyncCounts : afterPrewarm;
  };

  const label = (object: LabelledObject | undefined, prefix = "") => {
    const labels = asyncDepth > 0 ? asyncBuilds : lateBuilds;
    if (labels.length < MAX_LATE_LABELS) labels.push(prefix + labelOf(object));
  };

  const wrap = (name: string, key: keyof PipelineCounts) => {
    const backend = renderer.backend as unknown as Record<string, BackendFactory>;
    const original = backend[name];
    if (typeof original !== "function") return;
    backend[name] = (...args: never[]) => {
      countsNow()[key]++;
      if (prewarmed && key === "nodeBuilds") label(args[0] as LabelledObject | undefined);
      if (prewarmed && key === "pipelines")
        label((args[0] as { object?: LabelledObject } | undefined)?.object, "pipeline:");
      return original.apply(backend, args);
    };
  };

  wrap("createNodeBuilder", "nodeBuilds");
  wrap("createProgram", "programs");
  wrap("createRenderPipeline", "pipelines");

  return {
    /** Marks the end of the loading-screen prewarm: later creations count as hitches. */
    finishPrewarm: () => { prewarmed = true; },
    recordFrame: (cpuMs: number) => {
      if (!prewarmed) return;
      if (firstFrameMs.length < FIRST_FRAMES) firstFrameMs.push(cpuMs);
      worstFrameMs = Math.max(worstFrameMs, cpuMs);
    },
    stats: (): PipelineTrackerStats => ({
      afterPrewarm: { ...afterPrewarm },
      async: { ...asyncCounts },
      asyncBuilds: [...asyncBuilds],
      firstFrameMs: [...firstFrameMs],
      lateBuilds: [...lateBuilds],
      prewarm: { ...prewarm },
      worstFrameMs
    }),
    /** Counts the creations inside `build` (synchronous part) as async-compiler work. */
    trackAsync: <T>(build: () => T): T => {
      asyncDepth++;
      try { return build(); }
      finally { asyncDepth--; }
    }
  };
};
