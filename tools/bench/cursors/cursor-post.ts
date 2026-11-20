/**
 * 2D finishing of a rendered cursor: box-filtered downscale, a dark contour that keeps the silhouette crisp on
 * snow and on dark water, and a soft drop shadow baked down and to the right (away from the hotspot).
 */
const OUTLINE_COLOR = "#1a1009";
const SHADOW_COLOR = "rgba(8, 5, 2, .55)";

const canvasOf = (size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  return canvas;
};

/** Halves until `size`, so every output pixel averages the supersampled render (no aliasing, no halo). */
export const downscale = (source: HTMLCanvasElement, size: number) => {
  let current = source;
  while (current.width > size) {
    const next = canvasOf(Math.max(size, current.width / 2));
    const context = next.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  return current;
};

const tinted = (art: HTMLCanvasElement, color: string) => {
  const tint = canvasOf(art.width);
  const context = tint.getContext("2d")!;
  context.drawImage(art, 0, 0);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, art.width, art.height);
  return tint;
};

const contoured = (art: HTMLCanvasElement, scale: number) => {
  const contour = tinted(art, OUTLINE_COLOR);
  const result = canvasOf(art.width);
  const context = result.getContext("2d")!;
  const width = .9 * scale;
  for (let step = 0; step < 16; step++) {
    const angle = step / 16 * Math.PI * 2;
    context.drawImage(contour, Math.cos(angle) * width, Math.sin(angle) * width);
  }
  context.drawImage(art, 0, 0);
  return result;
};

/**
 * Stacks the layers (arrow first, badge on top), each inside its own contour, over one soft shadow of the
 * whole silhouette. `scale` is 1 for the 32 px cursor and 2 for @2x; contour and shadow scale with it.
 */
export const finishCursor = (layers: readonly HTMLCanvasElement[], scale: number) => {
  const stack = canvasOf(layers[0]!.width);
  const stackContext = stack.getContext("2d")!;
  for (const layer of layers) stackContext.drawImage(contoured(layer, scale), 0, 0);
  const result = canvasOf(stack.width);
  const context = result.getContext("2d")!;
  context.filter = `blur(${.9 * scale}px)`;
  context.drawImage(tinted(stack, SHADOW_COLOR), 1.1 * scale, 1.6 * scale);
  context.filter = "none";
  context.drawImage(stack, 0, 0);
  return result;
};

/** Straight (non premultiplied) RGBA bytes with fully transparent pixels zeroed, for the PNG optimiser. */
export const cursorPixels = (canvas: HTMLCanvasElement) => {
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 0; index < data.length; index += 4) if (data[index + 3] === 0) data.fill(0, index, index + 3);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
};
