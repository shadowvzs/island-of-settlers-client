import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseGraphics } from "../src/app/settings/choose-graphics";
import {
  BENCHMARK_MEGAPIXELS,
  type DeviceProbe,
  predictGpuMs,
  recommendDetail
} from "../src/app/settings/device-probe";
import {
  PROBE_MAX_FRAMES,
  PROBE_TIME_LIMIT_MS,
  runProbeLoop
} from "../src/app/settings/gpu-benchmark";
import {
  parseProbeFingerprint,
  type ProbeFingerprint,
  probeFingerprintChanged
} from "../src/app/settings/probe-fingerprint";

const DETAIL_KEY = "island-of-settlers.graphics.detail";
const RECOMMENDED_KEY = "island-of-settlers.graphics.recommended";
const FINGERPRINT_KEY = "island-of-settlers.graphics.probe";

const stubStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
};

afterEach(() => vi.unstubAllGlobals());

const desktop: DeviceProbe = {
  coarsePointer: false,
  cores: 16,
  gpuMs: 0.6,
  memory: 16,
  renderer: "NVIDIA GeForce RTX 3060",
  screenMegapixels: 2.07,
  webgl2: true
};

const integratedLaptop: DeviceProbe = {
  ...desktop,
  gpuMs: 4,
  renderer: "Intel(R) Iris(R) Xe Graphics"
};

/** The owner's reference phone (D-AI6): 1080x2340 at DPR ~2.6 = 2.6 MP. */
const referencePhone: DeviceProbe = {
  coarsePointer: true,
  cores: 8,
  gpuMs: 9,
  memory: 8,
  renderer: "ANGLE (ARM, Xclipse 530, OpenGL ES 3.2)",
  screenMegapixels: 2.59,
  webgl2: true
};

describe("device probe v2 decision table", () => {
  it("starts a typical desktop dGPU on High", () => {
    expect(recommendDetail(desktop)).toBe("high");
  });

  it("starts an integrated laptop on Medium or Low", () => {
    expect(recommendDetail(integratedLaptop)).toBe("low");
    expect(recommendDetail({ ...integratedLaptop, gpuMs: 2.5 })).toBe("medium");
  });

  it("starts the reference phone class (Samsung Galaxy A55 5G) on Minimal", () => {
    expect(recommendDetail(referencePhone)).toBe("minimal");
    // The class rule does not depend on the benchmark result.
    expect(recommendDetail({ ...referencePhone, gpuMs: 1 })).toBe("minimal");
  });

  it("keeps unknown GPUs on a safe default: Medium desktop, Low phone", () => {
    expect(recommendDetail({ ...desktop, gpuMs: null, renderer: "" })).toBe("medium");
    expect(recommendDetail({
      ...referencePhone, gpuMs: null, renderer: "", screenMegapixels: 1.2
    })).toBe("low");
  });

  it("scales the measured time to the window's megapixels (V3)", () => {
    expect(predictGpuMs(0.6, BENCHMARK_MEGAPIXELS)).toBeCloseTo(0.6);
    expect(recommendDetail({ ...desktop, screenMegapixels: BENCHMARK_MEGAPIXELS })).toBe("high");
    expect(recommendDetail({ ...desktop, screenMegapixels: 8.29 })).toBe("medium");
    expect(recommendDetail({ ...desktop, gpuMs: 2, screenMegapixels: 8.29 })).toBe("minimal");
  });

  it("still treats known-weak devices and software rendering as Minimal", () => {
    expect(recommendDetail({ ...desktop, cores: 2 })).toBe("minimal");
    expect(recommendDetail({ ...desktop, memory: 2 })).toBe("minimal");
    expect(recommendDetail({ ...desktop, renderer: "Google SwiftShader" })).toBe("minimal");
    expect(recommendDetail({ ...desktop, webgl2: false })).toBe("minimal");
  });
});

describe("probe time budget", () => {
  it("never draws past the 1.5 s budget with a slow clock", async () => {
    let clock = 0;
    const frames: number[] = [];
    const drawn = await runProbeLoop({
      nextFrame: async () => { clock += 250; },
      now: () => clock,
      step: frame => frames.push(frame)
    });
    expect(PROBE_TIME_LIMIT_MS).toBe(1500);
    expect(drawn).toBe(6);
    expect(frames).toEqual([0, 1, 2, 3, 4, 5]);
    expect(clock).toBeLessThanOrEqual(PROBE_TIME_LIMIT_MS);
  });

  it("keeps the 40-frame cap on a fast device and stops after one late frame", async () => {
    let fastClock = 0;
    const fast = await runProbeLoop({
      nextFrame: async () => { fastClock += 10; },
      now: () => fastClock,
      step: () => undefined
    });
    expect(fast).toBe(PROBE_MAX_FRAMES);
    let slowClock = 0;
    const slow = await runProbeLoop({
      nextFrame: async () => { slowClock += 400; },
      now: () => slowClock,
      step: () => undefined
    });
    expect(slow).toBe(4);
    expect(slowClock).toBeLessThanOrEqual(PROBE_TIME_LIMIT_MS + 400);
  });
});

describe("probe fingerprint", () => {
  const stored: ProbeFingerprint = {
    browser: "Chrome/120",
    renderer: "NVIDIA GeForce RTX 3060",
    screen: "1920x1080@1"
  };

  it("parses tolerantly", () => {
    expect(parseProbeFingerprint(null)).toBeNull();
    expect(parseProbeFingerprint("nope")).toBeNull();
    expect(parseProbeFingerprint('{"browser":"x"}')).toBeNull();
    expect(parseProbeFingerprint(JSON.stringify(stored))).toEqual(stored);
  });

  it("re-probes only when the browser, the screen or a known GPU changed", () => {
    expect(probeFingerprintChanged(null, stored)).toBe(true);
    expect(probeFingerprintChanged(stored, stored)).toBe(false);
    expect(probeFingerprintChanged(stored, { ...stored, browser: "Chrome/121" })).toBe(true);
    expect(probeFingerprintChanged(stored, { ...stored, screen: "2560x1440@1" })).toBe(true);
    expect(probeFingerprintChanged(stored, { ...stored, renderer: "AMD Radeon" })).toBe(true);
    // Before a probe the renderer is unknown: browser and screen decide.
    expect(probeFingerprintChanged(stored, { ...stored, renderer: "" })).toBe(false);
  });
});

describe("chooseGraphics re-probe", () => {
  const fingerprint: ProbeFingerprint = {
    browser: "Chrome/120",
    renderer: "",
    screen: "1920x1080@1"
  };
  const probeResult = {
    detail: "high" as const,
    probe: { ...desktop, renderer: "NVIDIA GeForce RTX 3060" }
  };

  it("probes the first run, then skips the probe while the fingerprint matches", async () => {
    const values = stubStorage();
    const detect = vi.fn(async () => probeResult);
    const first = await chooseGraphics(null, vi.fn(), { detect, fingerprint: () => fingerprint });
    expect(first).toEqual({ detail: "high", recommended: "high" });
    expect(detect).toHaveBeenCalledTimes(1);
    expect(values.get(DETAIL_KEY)).toBe("high");
    expect(values.get(RECOMMENDED_KEY)).toBe("high");
    expect(parseProbeFingerprint(values.get(FINGERPRINT_KEY) ?? null)?.renderer)
      .toBe("NVIDIA GeForce RTX 3060");
    const second = await chooseGraphics(null, vi.fn(), { detect, fingerprint: () => fingerprint });
    expect(second).toEqual({ detail: "high", recommended: "high" });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("re-probes on a device change and updates an automatic choice", async () => {
    stubStorage({
      [DETAIL_KEY]: "high",
      [FINGERPRINT_KEY]: JSON.stringify({ ...fingerprint, browser: "Chrome/119" }),
      [RECOMMENDED_KEY]: "high"
    });
    const detect = vi.fn(async () => ({ ...probeResult, detail: "medium" as const }));
    const choice = await chooseGraphics(null, vi.fn(), { detect, fingerprint: () => fingerprint });
    expect(detect).toHaveBeenCalledTimes(1);
    expect(choice).toEqual({ detail: "medium", recommended: "medium" });
  });

  it("keeps a manual choice across a re-probe and only refreshes the recommendation", async () => {
    const values = stubStorage({
      [DETAIL_KEY]: "minimal",
      [FINGERPRINT_KEY]: JSON.stringify({ ...fingerprint, screen: "800x600@1" }),
      [RECOMMENDED_KEY]: "medium"
    });
    const detect = vi.fn(async () => probeResult);
    const choice = await chooseGraphics(null, vi.fn(), { detect, fingerprint: () => fingerprint });
    expect(choice).toEqual({ detail: "minimal", recommended: "high" });
    expect(values.get(DETAIL_KEY)).toBe("minimal");
    expect(values.get(RECOMMENDED_KEY)).toBe("high");
  });

  it("adopts the current fingerprint without a probe on the upgrade launch", async () => {
    stubStorage({ [DETAIL_KEY]: "minimal", [RECOMMENDED_KEY]: "low" });
    const detect = vi.fn(async () => probeResult);
    const onProbe = vi.fn();
    const choice = await chooseGraphics(null, onProbe, { detect, fingerprint: () => fingerprint });
    expect(choice).toEqual({ detail: "minimal", recommended: "low" });
    expect(detect).not.toHaveBeenCalled();
    expect(onProbe).not.toHaveBeenCalled();
  });

  it("still lets ?quality= win without a probe", async () => {
    stubStorage({ [DETAIL_KEY]: "minimal", [RECOMMENDED_KEY]: "low" });
    const detect = vi.fn(async () => probeResult);
    expect(await chooseGraphics("medium", vi.fn(), { detect, fingerprint: () => fingerprint }))
      .toEqual({ detail: "medium", recommended: "low" });
    expect(detect).not.toHaveBeenCalled();
  });
});
