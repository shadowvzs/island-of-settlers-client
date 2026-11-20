import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseGraphics } from "../src/app/settings/choose-graphics";
import {
  BENCHMARK_MEGAPIXELS,
  type DeviceProbe,
  recommendDetail
} from "../src/app/settings/device-probe";

const DETAIL_KEY = "island-of-settlers.graphics.detail";
const RECOMMENDED_KEY = "island-of-settlers.graphics.recommended";

const stubStorage = (initial: Record<string, string>) => {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
};

afterEach(() => vi.unstubAllGlobals());

describe("detail choice", () => {
  it("lets ?quality= win over the stored level, without probing", async () => {
    stubStorage({ [DETAIL_KEY]: "minimal", [RECOMMENDED_KEY]: "low" });
    const onProbe = vi.fn();
    expect(await chooseGraphics("medium", onProbe)).toEqual({
      detail: "medium",
      recommended: "low"
    });
    expect(await chooseGraphics(null, onProbe)).toEqual({ detail: "minimal", recommended: "low" });
    expect(onProbe).not.toHaveBeenCalled();
  });
});

describe("device probe decision", () => {
  const desktop: DeviceProbe = {
    coarsePointer: false,
    cores: 16,
    gpuMs: 2,
    memory: 16,
    renderer: "NVIDIA GeForce RTX 3060",
    screenMegapixels: BENCHMARK_MEGAPIXELS,
    webgl2: true
  };

  it("picks the level from the measured GPU time at the benchmark pixel count", () => {
    expect(recommendDetail(desktop)).toBe("high");
    expect(recommendDetail({ ...desktop, gpuMs: 3 })).toBe("high");
    expect(recommendDetail({ ...desktop, gpuMs: 5 })).toBe("medium");
    expect(recommendDetail({ ...desktop, gpuMs: 9 })).toBe("low");
    expect(recommendDetail({ ...desktop, gpuMs: 14 })).toBe("minimal");
  });

  it("starts desktops without a measurement on Medium, never the optimistic High", () => {
    expect(recommendDetail({ ...desktop, gpuMs: null })).toBe("medium");
    expect(recommendDetail({ ...desktop, cores: null, gpuMs: null, memory: null })).toBe("medium");
  });

  it("caps phones and tablets at Low", () => {
    const phone = { ...desktop, coarsePointer: true, screenMegapixels: 1 };
    expect(recommendDetail(phone)).toBe("low");
    expect(recommendDetail({ ...phone, gpuMs: null })).toBe("low");
    expect(recommendDetail({ ...phone, gpuMs: 14 })).toBe("minimal");
  });

  it("starts software rendering, no WebGL2 or small devices on Minimal", () => {
    expect(recommendDetail({ ...desktop, renderer: "Google SwiftShader" })).toBe("minimal");
    expect(recommendDetail({ ...desktop, webgl2: false })).toBe("minimal");
    expect(recommendDetail({ ...desktop, cores: 2 })).toBe("minimal");
    expect(recommendDetail({ ...desktop, memory: 2 })).toBe("minimal");
  });
});
