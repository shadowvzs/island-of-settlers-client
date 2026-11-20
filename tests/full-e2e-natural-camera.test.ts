import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import { checkCameraZoomLimits } from "../tools/e2e/full/natural-ui-helpers";

/** Model lazy panel mounting and frame-published limits without replacing the production camera. */
const setup = (initiallyOpen = false, reachesLimit = true, missingControl = false) => {
  let open = initiallyOpen, panelReady = false, mounted = false;
  let limitPending = false;
  const presses = { "Zoom in": 0, "Zoom out": 0 };
  const toggle = vi.fn(async () => { open = !open; });
  const close = vi.fn(async () => { open = false; });
  const panel = {
    isVisible: async () => open,
    waitFor: async () => { expect(open).toBe(true); panelReady = true; },
    getByRole: (_role: string, { name }: { name: string }) => {
      if (name === "Close camera controls panel") return { click: close };
      const direction = name as keyof typeof presses;
      return {
        waitFor: async () => {
          expect(panelReady).toBe(true);
          if (missingControl) throw new Error("Lazy camera content never mounted");
          mounted = true;
        },
        isEnabled: async () => {
          expect(mounted).toBe(true);
          expect(limitPending).toBe(false);
          return !reachesLimit || presses[direction] < 2;
        },
        isDisabled: async () => reachesLimit && presses[direction] >= 2,
        click: async () => { presses[direction]++; limitPending = true; }
      };
    }
  };
  const page = {
    locator: (selector: string) => { expect(selector).toBe(".camera-controls-panel"); return panel; },
    getByRole: (_role: string, { name }: { name: string }) => {
      expect(name).toBe("Camera controls");
      return { click: toggle };
    },
    evaluate: async () => { limitPending = false; }
  };
  return { close, page: page as unknown as Page, presses, toggle };
};

describe("natural E2E camera panel driver", () => {
  it("opens the lazy panel, awaits its controls and checks both frame-published limits", async () => {
    const { close, page, toggle } = setup();
    expect(await checkCameraZoomLimits(page)).toEqual([
      { direction: "Zoom in", presses: 2, reachedDisabledLimit: true },
      { direction: "Zoom out", presses: 2, reachedDisabledLimit: true }
    ]);
    expect(toggle).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses an already open panel without toggling it shut", async () => {
    const { close, page, toggle } = setup(true);
    await checkCameraZoomLimits(page);
    expect(toggle).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("bounds failed limit checks and closes the panel before later cases", async () => {
    const { close, page, presses } = setup(false, false);
    await expect(checkCameraZoomLimits(page)).rejects.toThrow("never reached its documented limit");
    expect(presses["Zoom in"]).toBe(70);
    expect(presses["Zoom out"]).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails unavailable lazy content without attempting invisible controls", async () => {
    const { close, page, presses } = setup(false, true, true);
    await expect(checkCameraZoomLimits(page)).rejects.toThrow("never mounted");
    expect(presses["Zoom in"]).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });
});
