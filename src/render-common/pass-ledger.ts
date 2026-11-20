/** Mean cost of one named frame stage or render pass per profiled frame. */
export interface PassReport {
  cpuMs: number;
  drawCalls: number;
  /** Null for CPU-only stages and when no frame had a known GPU time. */
  gpuMs: number | null;
  name: string;
  triangles: number;
}

export interface FrameProfileReport {
  frameCpuMs: number;
  /** Mean GPU time of the timed passes; null while unknown (no timer, disjoint, pool full). */
  frameGpuMs: number | null;
  frames: number;
  /** Frames whose every pass query resolved without a disjoint event. */
  gpuFrames: number;
  /** Frames whose GPU time stays unknown. */
  gpuUnknownFrames: number;
  passes: PassReport[];
}

interface PassTotals {
  cpuMs: number;
  drawCalls: number;
  gpuMs: number;
  timed: boolean;
  triangles: number;
}

interface PendingGpuFrame {
  ms: number[];
  names: readonly string[];
  remaining: number;
}

const MAX_PENDING_FRAMES = 64;

const newTotals =(): PassTotals => ({ cpuMs: 0, drawCalls: 0, gpuMs: 0, timed: false, triangles: 0 });

/**
 * Pure aggregation of profiled frames: CPU, draw calls and triangles per pass arrive with the
 * frame; GPU times arrive later per query slot and count only once the whole frame is known.
 */
export const createPassLedger = () => {
  const totals = new Map<string, PassTotals>();
  const pendingGpu = new Map<number, PendingGpuFrame>();
  let frames = 0;
  let frameCpuMs = 0;
  let gpuFrames = 0;
  let gpuUnknownFrames = 0;
  let frameGpuMs = 0;

  const totalsOf = (name: string) => {
    let entry = totals.get(name);
    if (!entry) totals.set(name, entry = newTotals());
    return entry;
  };

  const addPass = (name: string, cpuMs: number, drawCalls: number, triangles: number) => {
    const entry = totalsOf(name);
    entry.cpuMs += cpuMs;
    entry.drawCalls += drawCalls;
    entry.triangles += triangles;
  };

  /** `gpuSlots`: pass names per query slot; null when the frame's GPU time is already unknown. */
  const closeFrame = (frame: number, cpuMs: number, gpuSlots: readonly string[] | null) => {
    frames++;
    frameCpuMs += cpuMs;
    if (gpuSlots === null) { gpuUnknownFrames++; return; }
    if (gpuSlots.length === 0) return;
    // A lost context never answers: the oldest frames give up instead of growing the map.
    if (pendingGpu.size >= MAX_PENDING_FRAMES) {
      pendingGpu.delete(pendingGpu.keys().next().value!);
      gpuUnknownFrames++;
    }
    pendingGpu.set(frame, { ms: new Array<number>(gpuSlots.length).fill(0), names: gpuSlots,
      remaining: gpuSlots.length });
  };

  const commitGpuFrame = (pending: PendingGpuFrame) => {
    let sum = 0;
    for (let slot = 0; slot < pending.names.length; slot++) {
      const entry = totalsOf(pending.names[slot]!);
      entry.gpuMs += pending.ms[slot]!;
      entry.timed = true;
      sum += pending.ms[slot]!;
    }
    gpuFrames++;
    frameGpuMs += sum;
    return sum;
  };

  /** Returns the frame's total GPU ms when this result completes a known frame, else null. */
  const resolveGpu = (frame: number, slot: number, ms: number | null) => {
    const pending = pendingGpu.get(frame);
    if (!pending) return null;
    if (ms === null) {
      pendingGpu.delete(frame);
      gpuUnknownFrames++;
      return null;
    }
    pending.ms[slot] = ms;
    if (--pending.remaining > 0) return null;
    pendingGpu.delete(frame);
    return commitGpuFrame(pending);
  };

  const report = (): FrameProfileReport => {
    const perFrame = Math.max(1, frames);
    const passes = [...totals].map(([name, entry]) => ({
      cpuMs: entry.cpuMs / perFrame,
      drawCalls: entry.drawCalls / perFrame,
      gpuMs: entry.timed && gpuFrames > 0 ? entry.gpuMs / gpuFrames : null,
      name,
      triangles: entry.triangles / perFrame
    }));
    return { frameCpuMs: frameCpuMs / perFrame, frameGpuMs: gpuFrames > 0 ? frameGpuMs / gpuFrames : null,
      frames, gpuFrames, gpuUnknownFrames, passes };
  };

  /** Clears the totals; frames still awaiting GPU results count in the next window. */
  const reset = () => {
    totals.clear();
    frames = 0; frameCpuMs = 0; gpuFrames = 0; gpuUnknownFrames = 0; frameGpuMs = 0;
  };

  return { addPass, closeFrame, report, reset, resolveGpu };
};
export type PassLedger = ReturnType<typeof createPassLedger>;
