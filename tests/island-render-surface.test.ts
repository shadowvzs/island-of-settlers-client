import { expect, it, vi } from "vitest";

import { replaceIslandRenderSurface } from "../src/app/island-render-surface";

const canvas = (name: string) => ({
  name,
  remove: vi.fn(),
  replaceWith: vi.fn()
}) as unknown as HTMLCanvasElement;

it("disposes the old renderer, swaps its canvas and creates the destination renderer", async () => {
  const events: string[] = [];
  const current = { canvas: canvas("old"), renderer: { id: "old renderer" } };
  const nextCanvas = canvas("new");
  const result = await replaceIslandRenderSurface({
    createCanvas: () => { events.push("canvas"); return nextCanvas; },
    createRenderer: async value => {
      events.push("create");
      expect(value).toBe(nextCanvas);
      return { id: "new renderer" };
    },
    current,
    disposeRenderer: async renderer => { events.push(`dispose:${renderer.id}`); }
  });
  expect(events).toEqual(["dispose:old renderer", "canvas", "create"]);
  expect(current.canvas.replaceWith).toHaveBeenCalledWith(nextCanvas);
  expect(result).toEqual({ canvas: nextCanvas, renderer: { id: "new renderer" } });
});

it("removes the replacement canvas when the destination renderer cannot be created", async () => {
  const nextCanvas = canvas("new");
  const current = { canvas: canvas("old"), renderer: {} };
  await expect(replaceIslandRenderSurface({
    createCanvas: () => nextCanvas,
    createRenderer: async () => { throw new Error("shader failed"); },
    current,
    disposeRenderer: vi.fn()
  })).rejects.toThrow("shader failed");
  expect(nextCanvas.remove).toHaveBeenCalledOnce();
});
