import { createGpuTimer } from "../../render-common/gpu-timer";

const WIDTH = 1280;
const HEIGHT = 720;
/** Frames drawn before the probe stops even when each one is fast. */
export const PROBE_MAX_FRAMES = 40;
/** The whole probe budget (C12): the first launch never waits longer than this. */
export const PROBE_TIME_LIMIT_MS = 1500;
/** Samples needed before a median is meaningful (the first two are warm-up). */
const MIN_SAMPLES = 5;

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

/**
 * Calibrated so the island on High needs about this budget: RTX 3060 ~0.6 ms, a 2 CU iGPU
 * ~9 ms.
 */
const FRAGMENT = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 color;
void main() {
  vec2 p = gl_FragCoord.xy * 0.01 + uSeed;
  float value = 0.0;
  for (int i = 0; i < 144; i++) {
    p = vec2(p.x * 1.03 + sin(p.y * 1.7 + value), p.y * 0.97 + cos(p.x * 1.3 - value));
    value += sin(p.x) * cos(p.y) * 0.05;
  }
  color = vec4(vec3(value), 1.0);
}`;

const compile = (gl: WebGL2RenderingContext) => {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT]
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
};

const drawQuad = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  const seed = gl.getUniformLocation(program, "uSeed");
  return (frame: number) => {
    gl.uniform1f(seed, frame * 0.37);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

/** Time source of the probe loop; tests pass a fake clock (C12 acceptance). */
export interface ProbeClock {
  nextFrame: () => Promise<void>;
  now: () => number;
}

const defaultProbeClock: ProbeClock = {
  nextFrame: () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())),
  now: () => performance.now()
};

export interface ProbeLoopOptions extends ProbeClock {
  /** Time budget of this loop, in ms. */
  limitMs?: number;
  /** Frame cap of this loop. */
  maxFrames?: number;
  /** Draws one benchmark frame; samples are collected by the caller. */
  step: (frame: number) => void;
}

/**
 * Draws benchmark frames until the frame cap or the time budget, whichever comes first; returns
 * the frames drawn. The budget is checked before every frame, so one slow frame can overshoot it
 * by at most its own duration.
 */
export const runProbeLoop = async ({
  limitMs = PROBE_TIME_LIMIT_MS,
  maxFrames = PROBE_MAX_FRAMES,
  nextFrame,
  now,
  step
}: ProbeLoopOptions) => {
  const started = now();
  let frame = 0;
  while (frame < maxFrames && now() - started < limitMs) {
    step(frame);
    frame += 1;
    await nextFrame();
  }
  return frame;
};

/**
 * Up to one and a half seconds of a fixed shading load on an offscreen canvas: GPU timer queries
 * when the browser has them, else CPU time around a draw forced to finish (a 1 pixel readback).
 * `clock` is injectable so the time budget can be verified without a real device.
 */
export const measureGpuMs = async (
  gl: WebGL2RenderingContext,
  clock: ProbeClock = defaultProbeClock
): Promise<number | null> => {
  const started = clock.now();
  const program = compile(gl);
  if (!program) return null;
  gl.viewport(0, 0, WIDTH, HEIGHT);
  const draw = drawQuad(gl, program);
  const timer = createGpuTimer(gl);
  const samples: number[] = [];
  const pixel = new Uint8Array(4);
  const step = (frame: number) => {
    const cpuStart = clock.now();
    timer?.begin();
    draw(frame);
    timer?.end();
    if (!timer) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      samples.push(clock.now() - cpuStart);
    }
    timer?.poll((milliseconds) => samples.push(milliseconds));
  };
  // Compiling and linking the shader counts against the same budget: the probe as a whole stays
  // under PROBE_TIME_LIMIT_MS, and a slow compile leaves no time for a meaningful measurement.
  const remaining = Math.max(0, PROBE_TIME_LIMIT_MS - (clock.now() - started));
  await runProbeLoop({ limitMs: remaining, nextFrame: clock.nextFrame, now: clock.now, step });
  return samples.length >= MIN_SAMPLES ? median(samples.slice(2)) : null;
};

/** A throw away WebGL2 context of the benchmark size (null without WebGL2). */
export const createProbeContext = () => {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return canvas.getContext("webgl2", { antialias: false, powerPreference: "high-performance" });
};
