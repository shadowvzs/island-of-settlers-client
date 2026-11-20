import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsStorage } from "../src/app/settings/graphics-settings";
import {
  DEFAULT_WORKER_COLOR,
  getWorkerColorHex,
  isWorkerColor,
  WORKER_COLORS
} from "../src/render-common/workers/worker-colors";
import { createWorkerDisplay } from "../src/render-common/workers/worker-display";

afterEach(() => vi.unstubAllGlobals());

const stubStorage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
};

describe("worker colour palette", () => {
  it("has seven distinct colours with blue #2f5bc4 as the default", () => {
    expect(WORKER_COLORS).toHaveLength(7);
    expect(new Set(WORKER_COLORS.map(({ hex }) => hex)).size).toBe(7);
    expect(DEFAULT_WORKER_COLOR).toBe("blue");
    expect(getWorkerColorHex(DEFAULT_WORKER_COLOR)).toBe("#2f5bc4");
    expect(isWorkerColor("yellow")).toBe(true);
    expect(isWorkerColor("pink")).toBe(false);
  });
});

describe("worker colour preference", () => {
  it("defaults to blue and remembers every palette colour", () => {
    const values = stubStorage();
    expect(settingsStorage.readWorkerColor()).toBe("blue");
    for (const { id } of WORKER_COLORS) {
      settingsStorage.writeWorkerColor(id);
      expect(settingsStorage.readWorkerColor()).toBe(id);
    }
    values.set("island-of-settlers.worker-color", "pink");
    expect(settingsStorage.readWorkerColor()).toBe("blue");
  });
});

describe("worker colour across a replacement", () => {
  it("recolours the current worker and keeps the colour for the next one", async () => {
    const worker = () => ({ dispose: vi.fn(), setColor: vi.fn() });
    const old = worker();
    const next = worker();
    const display = createWorkerDisplay(old, async () => next);
    display.setColor("#c62828");
    expect(old.setColor).toHaveBeenCalledWith("#c62828");
    await display.replace({ nation: "viking", variant: "viking-woman-blue" });
    expect(next.setColor).toHaveBeenCalledWith("#c62828");
  });
});
