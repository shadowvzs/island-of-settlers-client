import type { DrawCounter } from "./frame-stats";
import { createGpuPassTimer, type GpuPassTimer } from "./gpu-timer";
import { createPassLedger, type FrameProfileReport } from "./pass-ledger";

/**
 * R01 dev profiler (`?passes=1`): sequential marks split each frame into named CPU stages and
 * GPU-timed render passes, with draw calls and triangles per mark. Disabled (the default) every
 * mark is one null check; nothing here ever feeds back into the simulation or the image.
 */
interface FrameProfiler {
  beginFrame: () => void;
  currentMark: () => string | null;
  endFrame: () => void;
  mark: (name: string, gpu: boolean) => void;
  poll: (onFrameGpu: (milliseconds: number) => void) => void;
  resetSession: () => void;
  rollWindow: () => FrameProfileReport;
  sessionReport: () => FrameProfileReport;
}

let active: FrameProfiler | null = null;

/** A CPU-only stage of the frame (loop updates, frame building). */
export const markFrameStage = (name: string) => {
  if (active !== null) active.mark(name, false);
};

/** A render pass: CPU submit, GPU time, draw calls and triangles until the next mark. */
export const markRenderPass = (name: string) => {
  if (active !== null) active.mark(name, true);
};

/** The open mark (a counter attributing work to the pass that caused it); null when off. */
export const currentFrameMark = () => (active === null ? null : active.currentMark());

export const activeFrameProfiler = () => active;

interface OpenMark {
  drawCalls: number;
  gpu: boolean;
  name: string;
  startedAt: number;
  triangles: number;
}

const createProfiler = (counter: DrawCounter, timer: GpuPassTimer | null, now: () => number): FrameProfiler => {
  const windowLedger = createPassLedger();
  const sessionLedger = createPassLedger();
  let frame = 0;
  let frameStartedAt = 0;
  let gpuUnknown = false;
  /** Marks outside a loop frame (first-frame preparation renders) are not profiled. */
  let inFrame = false;
  let slots: string[] = [];
  let open: OpenMark | null = null;

  const close = () => {
    if (open === null) return;
    const cpuMs = now() - open.startedAt;
    const drawCalls = counter.drawCalls - open.drawCalls;
    const triangles = counter.triangles - open.triangles;
    windowLedger.addPass(open.name, cpuMs, drawCalls, triangles);
    sessionLedger.addPass(open.name, cpuMs, drawCalls, triangles);
    if (open.gpu) timer?.end();
    open = null;
  };

  const mark = (name: string, gpu: boolean) => {
    if (!inFrame) return;
    close();
    const timed = gpu && timer !== null && timer.begin(frame, slots.length);
    if (timed) slots.push(name);
    else if (gpu) gpuUnknown = true;
    open = { drawCalls: counter.drawCalls, gpu: timed, name, startedAt: now(), triangles: counter.triangles };
  };

  const endFrame = () => {
    if (!inFrame) return;
    inFrame = false;
    close();
    const cpuMs = now() - frameStartedAt;
    const gpuSlots = gpuUnknown ? null : slots;
    windowLedger.closeFrame(frame, cpuMs, gpuSlots);
    sessionLedger.closeFrame(frame, cpuMs, gpuSlots);
  };

  const poll = (onFrameGpu: (milliseconds: number) => void) => timer?.poll(result => {
    const total = windowLedger.resolveGpu(result.frame, result.slot, result.ms);
    sessionLedger.resolveGpu(result.frame, result.slot, result.ms);
    if (total !== null) onFrameGpu(total);
  });

  return {
    beginFrame: () => {
      close();
      inFrame = true;
      frame++;
      frameStartedAt = now();
      gpuUnknown = timer === null;
      slots = [];
    },
    currentMark: () => open?.name ?? null,
    endFrame,
    mark,
    poll,
    resetSession: sessionLedger.reset,
    rollWindow: () => {
      const report = windowLedger.report();
      windowLedger.reset();
      return report;
    },
    sessionReport: sessionLedger.report
  };
};

/** Turns the profiler on for `gl`; `counter` is the loop's draw counter (instrumentDrawCalls). */
export const startFrameProfiler = (gl: WebGL2RenderingContext, counter: DrawCounter,
  now: () => number = () => performance.now()) => {
  active = createProfiler(counter, createGpuPassTimer(gl), now);
  (globalThis as { __frameProfiler?: FrameProfiler }).__frameProfiler = active;
  return active;
};

export const stopFrameProfiler = () => {
  active = null;
  delete (globalThis as { __frameProfiler?: FrameProfiler }).__frameProfiler;
};
