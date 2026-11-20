/** Ordered phases of one in-page island replacement. */
export type HandoffPhase =
  | "activate"
  | "departure-capture"
  | "departure-write"
  | "destination-commit"
  | "dispose"
  | "freeze"
  | "install"
  | "prepare"
  | "reload-required"
  | "resume-old"
  | "settle";

/** Optional resource counts sampled around a handoff (diagnostics, not exact driver VRAM). */
export interface HandoffResourceSample {
  /** Live GPU objects reported by the renderer, when available. */
  gpuObjects?: number;
  /** Decoded heap bytes (`performance.memory`), when the browser exposes it. */
  heapBytes?: number;
  /** Registered event listeners, when the harness exposes them. */
  listeners?: number;
  /** Live WebGL renderers/contexts owned by the app. */
  renderers?: number;
  /** Worker instances owned by the page. */
  workers?: number;
}

export interface HandoffPhaseTiming {
  /** Milliseconds since the receipt started. */
  atMs: number;
  /** Milliseconds since the previous phase mark. */
  durationMs: number;
  phase: HandoffPhase;
}

export interface HandoffResourceTiming extends HandoffResourceSample {
  atMs: number;
}

export interface HandoffReceiptSnapshot {
  phases: readonly HandoffPhaseTiming[];
  samples: readonly HandoffResourceTiming[];
  startedAt: number;
  totalMs: number;
}

export interface HandoffReceipt {
  mark: (phase: HandoffPhase) => void;
  sample: (values: HandoffResourceSample) => void;
  snapshot: () => HandoffReceiptSnapshot;
}

const MAX_PHASES = 64;
const MAX_SAMPLES = 32;

/**
 * Bounded in-memory receipt for ordered phase timings and a few resource counts. It owns no timer,
 * listener or retained island object; one receipt is discarded with the handoff.
 */
export const createHandoffReceipt = (
  options: { now?: () => number } = {}
): HandoffReceipt => {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  let last = startedAt;
  const phases: HandoffPhaseTiming[] = [];
  const samples: HandoffResourceTiming[] = [];
  return {
    mark: phase => {
      const at = now();
      phases.push({ atMs: at - startedAt, durationMs: at - last, phase });
      last = at;
      if (phases.length > MAX_PHASES) phases.shift();
    },
    sample: values => {
      samples.push({ ...values, atMs: now() - startedAt });
      if (samples.length > MAX_SAMPLES) samples.shift();
    },
    snapshot: () => ({
      phases: phases.map(phase => ({ ...phase })),
      samples: samples.map(sample => ({ ...sample })),
      startedAt,
      totalMs: now() - startedAt
    })
  };
};
