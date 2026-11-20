import type { LaunchOptions } from "playwright-core";

const CHROME_PATH = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

/**
 * GPU=igpu runs Chrome on the AMD integrated GPU (Mesa EGL through ANGLE) instead of the NVIDIA
 * card: the weak hardware profile of the benchmark.
 */
const useIntegratedGpu = process.env.GPU === "igpu";
/** WG-0: opt in to Chrome's WebGPU adapter; `WEBGPU_ANGLE=vulkan` asks for the native Vulkan path. */
const enableWebGpu = process.env.WEBGPU === "1";
const webgpuVulkan = process.env.WEBGPU_ANGLE === "vulkan";
const webgpuGl = process.env.WEBGPU_ANGLE === "gl";

const angleFlag = () => {
  if (useIntegratedGpu) return "--use-angle=gl-egl";
  if (webgpuVulkan) return "--use-angle=vulkan";
  if (webgpuGl) return "--use-angle=gl";
  return "--use-angle=default";
};

const INTEGRATED_GPU_ENV = {
  __EGL_VENDOR_LIBRARY_FILENAMES: "/usr/share/glvnd/egl_vendor.d/50_mesa.json"
};

/**
 * Chrome with the real GPU (ANGLE), not SwiftShader, so numbers and pixels mean something. Shared
 * by the bench drivers (`browser.ts`) and the Playwright test runner (`playwright.config.ts`).
 */
export const getChromeLaunchOptions = (uncapped = false): LaunchOptions => ({
  args: [
    "--ignore-gpu-blocklist",
    "--enable-gpu",
    ...(enableWebGpu ? ["--enable-unsafe-webgpu",
      ...(webgpuVulkan || webgpuGl ? ["--enable-features=Vulkan", "--disable-gpu-sandbox"] : [])] : []),
    angleFlag(),
    ...(uncapped ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : [])
  ],
  env: useIntegratedGpu ? { ...process.env, ...INTEGRATED_GPU_ENV } : undefined,
  executablePath: CHROME_PATH,
  headless: process.env.HEADED !== "1"
});

/** Baselines are per GPU profile (test strategy §5): never compare NVIDIA pixels with iGPU ones. */
export const GPU_PROFILE = useIntegratedGpu ? "igpu" : "gpu";
