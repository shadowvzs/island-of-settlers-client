/** One island's canvas and renderer; both belong to that island session. */
export interface IslandRenderSurface<Renderer> {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
}

/**
 * Creates a replacement canvas in the same document position. Size is deliberately not copied: the new
 * renderer owns its drawing buffer, and copying stale dimensions can briefly allocate the old size.
 */
export const createReplacementCanvas = (old: HTMLCanvasElement): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  for (const attribute of old.attributes) {
    if (["height", "width", "data-army-cursor"].includes(attribute.name)) continue;
    canvas.setAttribute(attribute.name, attribute.value);
  }
  // Cursor/edge-scroll state belongs to the departing interaction, not the new render surface.
  canvas.style.removeProperty("cursor");
  return canvas;
};

/**
 * Phase-1 in-page renderer replacement: the old island's renderer (including its WebGL context) is
 * disposed first, then its canvas is replaced in place and a fresh renderer is created on the new
 * canvas. A failed creation removes the unowned canvas; the caller must reload the committed
 * destination because the old context is already gone.
 */
export const replaceIslandRenderSurface = async <Renderer>(options: {
  createCanvas: () => HTMLCanvasElement;
  createRenderer: (canvas: HTMLCanvasElement) => Promise<Renderer>;
  current: IslandRenderSurface<Renderer>;
  disposeRenderer: (renderer: Renderer) => Promise<void> | void;
}): Promise<IslandRenderSurface<Renderer>> => {
  await options.disposeRenderer(options.current.renderer);
  const canvas = options.createCanvas();
  options.current.canvas.replaceWith(canvas);
  try {
    const renderer = await options.createRenderer(canvas);
    return { canvas, renderer };
  } catch (error) {
    canvas.remove();
    throw error;
  }
};
