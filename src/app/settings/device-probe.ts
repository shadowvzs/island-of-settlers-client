import { QUALITY_LEVELS, type QualityLevel } from "../../render-common/quality";

/** What the first run learns about the device (all optional: browsers expose different parts). */
export interface DeviceProbe {
  coarsePointer: boolean;
  cores: number | null;
  /** Approximate GB (navigator.deviceMemory, Chromium only). */
  memory: number | null;
  /** ms per frame of the benchmark shader at its fixed 1280 x 720 size; null when it could not run. */
  gpuMs: number | null;
  /** Unmasked GPU renderer string. */
  renderer: string;
  /** Drawing-buffer megapixels of the display at the device pixel ratio (the pixel budget). */
  screenMegapixels: number;
  webgl2: boolean;
}

/** Pixels of one benchmark frame (1280 x 720): the measurement all decisions are scaled from. */
export const BENCHMARK_MEGAPIXELS = (1280 * 720) / 1_000_000;
/** A window this small is treated as the benchmark size: below it the scaling gains nothing. */
const MIN_MEGAPIXELS = 0.5;

/**
 * Benchmark ms per frame up to which a Detail level is recommended, after scaling the measured
 * time to the display's own pixel count (V3: the 0.92 MP measurement alone favors HiDPI laptops).
 * The calibration is a code estimate: an RTX 3060 needs ~0.6 ms and a 2 CU iGPU ~9 ms.
 */
const GPU_MS_LIMITS: readonly { level: QualityLevel; maxGpuMs: number }[] = [
  { level: "high", maxGpuMs: 3 },
  { level: "medium", maxGpuMs: 6 },
  { level: "low", maxGpuMs: 12 }
];
/** Phones and tablets (coarse pointer) start at most on Low: battery and heat. */
const TOUCH_DEVICE_CAP: QualityLevel = "low";
/**
 * The owner's reference phone class (D-AI6, 2026-11-08: Samsung Galaxy A55 5G, 1080x2340 at
 * DPR ~2.6 = 2.6 MP) starts on Minimal; a high-DPI phone has a large native pixel budget even
 * after the Resolution profile shrinks the drawing buffer, and the weak-device budget is Minimal.
 */
const REFERENCE_PHONE_MEGAPIXELS = 2.4;
/** Without a measurement a desktop starts on Medium: never the optimistic High (V7). */
const UNKNOWN_DEVICE_DEFAULT: QualityLevel = "medium";
/** Fewer CPU cores or GB of memory than this: a very small device. */
const MIN_CORES = 4;
const MIN_MEMORY_GB = 4;

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** The unmasked GPU renderer string (the masked one when the debug extension is missing). */
export const getRendererString = (gl: WebGL2RenderingContext) => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
};

/** Software WebGL (SwiftShader, llvmpipe, Microsoft Basic Render Driver…): no GPU. */
export const isSoftwareRenderer = (renderer: string) => SOFTWARE_GPU.test(renderer);

/**
 * Known-too-small devices only: a missing deviceMemory or hardwareConcurrency (Firefox, Safari)
 * is unknown, never a pass (V7), and the measurement decides.
 */
const isUnfitDevice = (probe: DeviceProbe) =>
  !probe.webgl2 ||
  isSoftwareRenderer(probe.renderer) ||
  (probe.cores !== null && probe.cores < MIN_CORES) ||
  (probe.memory !== null && probe.memory < MIN_MEMORY_GB);

const getLevelForGpuMs = (gpuMs: number): QualityLevel =>
  GPU_MS_LIMITS.find(({ maxGpuMs }) => gpuMs <= maxGpuMs)?.level ?? "minimal";

const capLevel = (level: QualityLevel, cap: QualityLevel) =>
  QUALITY_LEVELS[Math.min(QUALITY_LEVELS.indexOf(level), QUALITY_LEVELS.indexOf(cap))]!;

/**
 * The benchmark time at this display's pixel count (the shader is fragment-bound). The ratio is
 * formed first, so an exact benchmark-size display scales by exactly 1 and keeps the thresholds
 * inclusive at their boundary.
 */
export const predictGpuMs = (gpuMs: number, screenMegapixels: number) =>
  gpuMs * (Math.max(screenMegapixels, MIN_MEGAPIXELS) / BENCHMARK_MEGAPIXELS);

/**
 * Pure MP-aware decision (C12): no WebGL2, software rendering or a device known to be under 4
 * cores / 4 GB starts on Minimal; a large high-DPI phone (the A55 class) starts on Minimal too.
 * Else the measured GPU time, scaled to the display's megapixels, picks the level; without a
 * measurement desktops get Medium (never High); touch devices are capped at Low.
 */
export const recommendDetail = (probe: DeviceProbe): QualityLevel => {
  if (isUnfitDevice(probe)) return "minimal";
  if (probe.coarsePointer && probe.screenMegapixels >= REFERENCE_PHONE_MEGAPIXELS) return "minimal";
  const level = probe.gpuMs === null
    ? UNKNOWN_DEVICE_DEFAULT
    : getLevelForGpuMs(predictGpuMs(probe.gpuMs, probe.screenMegapixels));
  return probe.coarsePointer ? capLevel(level, TOUCH_DEVICE_CAP) : level;
};
