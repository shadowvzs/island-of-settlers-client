import { type DeviceProbe, getRendererString, recommendDetail } from "./device-probe";
import { createProbeContext, measureGpuMs } from "./gpu-benchmark";

/** Below this a window is treated as the benchmark size: V3's scaling has nothing to add. */
const MIN_SCREEN_MEGAPIXELS = 0.5;

/**
 * Drawing-buffer megapixels of the display at the device ratio: the pixel budget the MP-aware
 * decision scales the benchmark to (V3: a 4K HiDPI laptop renders far more pixels than the
 * 0.92 MP benchmark). The screen is preferred over the window, so the verdict describes the
 * device class even when the game runs windowed; the viewport is the fallback.
 */
export const readScreenMegapixels = () => {
  const ratio = globalThis.devicePixelRatio || 1;
  const screenInfo = globalThis.screen;
  const width = screenInfo?.width || globalThis.innerWidth || 0;
  const height = screenInfo?.height || globalThis.innerHeight || 0;
  return Math.max(MIN_SCREEN_MEGAPIXELS, (width * height * ratio * ratio) / 1_000_000);
};

/** First run only: probes the device (at most about one and a half seconds) and recommends a level. */
export const detectDetail = async () => {
  const gl = createProbeContext();
  const navigatorInfo = navigator as Navigator & { deviceMemory?: number };
  const probe: DeviceProbe = {
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    cores: navigator.hardwareConcurrency || null,
    gpuMs: gl ? await measureGpuMs(gl) : null,
    memory: navigatorInfo.deviceMemory ?? null,
    renderer: gl ? getRendererString(gl) : "",
    screenMegapixels: readScreenMegapixels(),
    webgl2: gl !== null
  };
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return { detail: recommendDetail(probe), probe };
};
