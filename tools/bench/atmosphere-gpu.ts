import type { WebGLRenderer } from "three";

const percentile = (sorted: number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;

/** Verification-only GPU queries. Poll in later animation frames; never stall production. */
export const measureAtmosphereGpu = async (
  renderer: WebGLRenderer,
  render: () => void,
  count = 24
) => {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const gpu: number[] = [];
  const cpu: number[] = [];
  let rejected = 0;
  for (let warm = 0; warm < 12; warm++) render();
  for (let index = 0; index < count; index++) {
    await new Promise<void>(done => requestAnimationFrame(() => done()));
    const query = timer ? gl.createQuery() : null;
    if (query) gl.beginQuery(timer!.TIME_ELAPSED_EXT, query);
    const started = performance.now();
    render();
    cpu.push(performance.now() - started);
    if (!query) continue;
    gl.endQuery(timer!.TIME_ELAPSED_EXT);
    let available = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise<void>(done => requestAnimationFrame(() => done()));
      available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      if (available) break;
    }
    if (available && !gl.getParameter(timer!.GPU_DISJOINT_EXT)) {
      gpu.push(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
    } else {
      rejected++;
    }
    gl.deleteQuery(query);
  }
  cpu.sort((left, right) => left - right);
  gpu.sort((left, right) => left - right);
  return {
    cpuSubmissionMedianMs: percentile(cpu, .5),
    cpuSubmissionP95Ms: percentile(cpu, .95),
    gpuMedianMs: percentile(gpu, .5),
    gpuP95Ms: percentile(gpu, .95),
    rejected,
    samples: gpu.length,
    timerAvailable: Boolean(timer)
  };
};

/** readPixels deliberately stays in this diagnostic fixture, outside timed draws. */
export const readAtmospherePixels = (renderer: WebGLRenderer) => {
  const gl = renderer.getContext();
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
};

export const summarizeAtmospherePixels = (pixels: Uint8Array) => {
  let hash = 2166136261;
  const totals = [0, 0, 0];
  for (let index = 0; index < pixels.length; index++) {
    hash = Math.imul(hash ^ pixels[index]!, 16777619);
    if (index % 4 < 3) totals[index % 4]! += pixels[index]!;
  }
  return { hash: hash >>> 0, meanRgb: totals.map(value => value / (pixels.length / 4)) };
};

export const compareAtmospherePixels = (reference: Uint8Array, candidate: Uint8Array) => {
  if (reference.length !== candidate.length) throw new Error("Drawing buffers differ");
  let maximum = 0;
  let changed = 0;
  let total = 0;
  for (let index = 0; index < reference.length; index++) {
    if (index % 4 === 3) continue;
    const difference = Math.abs(reference[index]! - candidate[index]!);
    maximum = Math.max(maximum, difference);
    total += difference;
    if (difference > 0) changed++;
  }
  return { changedChannels: changed, maximum, meanAbsolute: total / (reference.length * .75) };
};
