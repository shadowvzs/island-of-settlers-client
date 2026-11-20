import { PerspectiveCamera } from "three";
import { afterEach, expect, it, vi } from "vitest";

import { HOVER_POINTER_CURSOR } from "../src/render-common/ui-cursor";
import { createRendererPicking } from "../src/renderers/three/three-renderer-picking";

class Canvas extends EventTarget {
  style = { cursor: "" };
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}
const event = (type: string, pointerType = "mouse") =>
  Object.assign(new Event(type), { clientX: 10, clientY: 10, pointerType });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("clears actual building hover on pointer leave and touch release while preserving mouse selection events", () => {
  const canvas = new Canvas(), setHover = vi.fn(() => true), shipHover = vi.fn();
  vi.stubGlobal("document", { elementFromPoint: () => canvas });
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const picking = createRendererPicking(canvas as unknown as HTMLCanvasElement,
    {} as Parameters<typeof createRendererPicking>[1],
    { pickHit: () => ({ id: "home", distance: 1 }), setHover } as unknown as Parameters<typeof createRendererPicking>[2],
    { pickHit: () => null, setHover: shipHover } as unknown as Parameters<typeof createRendererPicking>[3]);
  picking.setView(new PerspectiveCamera(), { viewportWidth: 100, viewportHeight: 100 } as
    Parameters<typeof picking.setView>[1]);
  canvas.dispatchEvent(event("pointermove")); picking.updateHover();
  expect(setHover).toHaveBeenLastCalledWith("home");
  canvas.dispatchEvent(event("pointerup"));
  expect(setHover).toHaveBeenLastCalledWith("home");
  canvas.dispatchEvent(event("pointerleave"));
  expect(setHover).toHaveBeenLastCalledWith(null);
  canvas.dispatchEvent(event("pointermove")); picking.updateHover();
  expect(setHover).toHaveBeenLastCalledWith("home");
  canvas.dispatchEvent(event("pointerup", "touch"));
  expect(setHover).toHaveBeenLastCalledWith(null);
  picking.updateHover();
  expect(setHover).toHaveBeenLastCalledWith(null);
  const calls = setHover.mock.calls.length;
  picking.dispose();
  canvas.dispatchEvent(event("pointerup", "touch"));
  expect(setHover).toHaveBeenCalledTimes(calls);
});

it("routes only the visible decoration UID into hover and clears it for occlusion, overlays, leave and disposal", () => {
  const canvas = new Canvas(), decorationHover = vi.fn((uid: number | null) => uid !== null);
  const buildingHover = vi.fn((id: string | null) => id !== null);
  let buildingDistance = 2, unobscured = true;
  vi.stubGlobal("document", { elementFromPoint: () => unobscured ? canvas : {} });
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const picking = createRendererPicking(canvas as unknown as HTMLCanvasElement,
    {} as Parameters<typeof createRendererPicking>[1],
    { pickHit: () => ({ id: "home", distance: buildingDistance }), setHover: buildingHover } as unknown as Parameters<typeof createRendererPicking>[2],
    { pickHit: () => null, setHover: vi.fn() } as unknown as Parameters<typeof createRendererPicking>[3],
    undefined, undefined, { pick: () => ({ uid: 7, distance: 1 }), setHover: decorationHover });
  picking.setView(new PerspectiveCamera(), { viewportWidth: 100, viewportHeight: 100 } as Parameters<typeof picking.setView>[1]);
  canvas.dispatchEvent(event("pointermove")); picking.updateHover();
  expect(decorationHover).toHaveBeenLastCalledWith(7); expect(buildingHover).toHaveBeenLastCalledWith(null);
  expect(canvas.style.cursor).toBe(HOVER_POINTER_CURSOR);
  const unchanged = decorationHover.mock.calls.length; picking.updateHover();
  expect(decorationHover).toHaveBeenCalledTimes(unchanged);
  buildingDistance = .5; canvas.dispatchEvent(event("pointermove")); picking.updateHover();
  expect(picking.pickRoadDecoration(10, 10)).toBeNull(); expect(decorationHover).toHaveBeenLastCalledWith(null);
  expect(buildingHover).toHaveBeenLastCalledWith("home");
  unobscured = false; canvas.dispatchEvent(event("pointermove")); picking.updateHover();
  expect(decorationHover).toHaveBeenLastCalledWith(null); expect(canvas.style.cursor).toBe("");
  canvas.dispatchEvent(event("pointerleave")); expect(decorationHover).toHaveBeenLastCalledWith(null);
  picking.dispose(); expect(decorationHover).toHaveBeenLastCalledWith(null);
});
