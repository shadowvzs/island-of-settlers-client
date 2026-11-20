const DEFAULT_WINDOW = 240;

const TRIANGLES_PER_MODE: Record<number, (count: number) => number> = {
  4: (count) => count / 3,
  5: (count) => Math.max(0, count - 2),
  6: (count) => Math.max(0, count - 2)
};

export interface DrawCounter {
  drawCalls: number;
  triangles: number;
}

/**
 * Counts draw calls and triangles by wrapping the WebGL2 draw functions (independent of the
 * renderer's own bookkeeping).
 */
export const instrumentDrawCalls = (gl: WebGL2RenderingContext): DrawCounter => {
  const counter: DrawCounter = { drawCalls: 0, triangles: 0 };
  const count = (mode: number, vertices: number, instances = 1) => {
    counter.drawCalls += 1;
    counter.triangles += (TRIANGLES_PER_MODE[mode]?.(vertices) ?? 0) * instances;
  };
  const drawElements = gl.drawElements.bind(gl);
  const drawArrays = gl.drawArrays.bind(gl);
  const drawElementsInstanced = gl.drawElementsInstanced.bind(gl);
  const drawArraysInstanced = gl.drawArraysInstanced.bind(gl);
  gl.drawElements = (mode, vertices, type, offset) => {
    count(mode, vertices);
    drawElements(mode, vertices, type, offset);
  };
  gl.drawArrays = (mode, first, vertices) => {
    count(mode, vertices);
    drawArrays(mode, first, vertices);
  };
  gl.drawElementsInstanced = (mode, vertices, type, offset, instances) => {
    count(mode, vertices, instances);
    drawElementsInstanced(mode, vertices, type, offset, instances);
  };
  gl.drawArraysInstanced = (mode, first, vertices, instances) => {
    count(mode, vertices, instances);
    drawArraysInstanced(mode, first, vertices, instances);
  };
  return counter;
};

/**
 * averageFps: from the 1-99 % trimmed mean frame interval (single hitches do not dominate).
 * gpuMs / gpuMsP95: GPU time per frame from timer queries (0 when unsupported).
 */
export interface FrameSummary {
  averageFps: number;
  cpuMs: number;
  drawCalls: number;
  frameMsP95: number;
  gpuMs: number;
  gpuMsP95: number;
  lowFps: number;
  triangles: number;
}

const trimmedMean = (sorted: number[]) => {
  const trimmed = sorted.slice(Math.floor(sorted.length * 0.01), Math.ceil(sorted.length * 0.99));
  return trimmed.reduce((sum, value) => sum + value, 0) / Math.max(1, trimmed.length);
};

/** Rolling window of frame intervals and per frame CPU cost (a big window = whole run). */
export const createFrameStats = (counter: DrawCounter) => {
  const windowSize = DEFAULT_WINDOW;
  const intervals = new Float32Array(windowSize);
  const cpuTimes = new Float32Array(windowSize);
  const gpuTimes = new Float32Array(windowSize);
  let gpuCursor = 0;
  let gpuFilled = 0;
  let cursor = 0;
  let filled = 0;
  let lastDrawCalls = 0;
  let lastTriangles = 0;

  const beginFrame = () => {
    counter.drawCalls = 0;
    counter.triangles = 0;
  };

  const endFrame = (intervalMs: number, cpuMs: number) => {
    intervals[cursor] = intervalMs;
    cpuTimes[cursor] = cpuMs;
    cursor = (cursor + 1) % windowSize;
    filled = Math.min(windowSize, filled + 1);
    lastDrawCalls = counter.drawCalls;
    lastTriangles = counter.triangles;
  };

  const recordGpu = (milliseconds: number) => {
    gpuTimes[gpuCursor] = milliseconds;
    gpuCursor = (gpuCursor + 1) % windowSize;
    gpuFilled = Math.min(windowSize, gpuFilled + 1);
  };

  const summarize = (): FrameSummary => {
    const frames = Array.from(intervals.subarray(0, filled)).sort((a, b) => a - b);
    const gpu = Array.from(gpuTimes.subarray(0, gpuFilled)).sort((a, b) => a - b);
    const meanInterval = trimmedMean(frames);
    const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
    const p99 = frames[Math.floor(frames.length * 0.99)] ?? 0;
    const cpuTotal = cpuTimes.subarray(0, filled).reduce((sum, value) => sum + value, 0);
    return {
      averageFps: meanInterval > 0 ? 1000 / meanInterval : 0,
      cpuMs: filled > 0 ? cpuTotal / filled : 0,
      drawCalls: lastDrawCalls,
      frameMsP95: p95,
      gpuMs: trimmedMean(gpu),
      gpuMsP95: gpu[Math.floor(gpu.length * 0.95)] ?? 0,
      lowFps: p99 > 0 ? 1000 / p99 : 0,
      triangles: lastTriangles
    };
  };

  const reset = () => {
    cursor = 0;
    filled = 0;
    gpuCursor = 0;
    gpuFilled = 0;
  };

  return { beginFrame, endFrame, recordGpu, reset, summarize };
};
