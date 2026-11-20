/** Icon edge (CSS pixels, the panel's icon size); the files come in 1x and 2x (hi-dpi). */
const ICON_SIZE = 40;
const ICON_SCALES = [1, 2] as const;
/** Transparent margin around a trimmed item (share of the icon edge). */
const MARGIN = 0.04;
/** Alpha above which a pixel counts as part of the item. */
const OPAQUE = 8;

interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export const getContext = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
};

/** A region of the source (a 2D or WebGL canvas) copied into a 2D canvas of its own. */
const copyRegion = (source: HTMLCanvasElement, { height, width, x, y }: Bounds) => {
  const canvas = createCanvas(width, height);
  getContext(canvas).drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
};

const getWholeBounds = (canvas: HTMLCanvasElement): Bounds => ({
  height: canvas.height,
  width: canvas.width,
  x: 0,
  y: 0
});

/** Bounds of the opaque pixels (the whole canvas when nothing is opaque). */
const findOpaqueBounds = (canvas: HTMLCanvasElement): Bounds => {
  const { data } = getContext(canvas).getImageData(0, 0, canvas.width, canvas.height);
  let [minX, minY, maxX, maxY] = [canvas.width, canvas.height, -1, -1];
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3]! <= OPAQUE) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return getWholeBounds(canvas);
  return { height: maxY - minY + 1, width: maxX - minX + 1, x: minX, y: minY };
};

/** Halves the canvas while it stays at least twice `size` (clean, sharp downscaling). */
const halveTowards = (source: HTMLCanvasElement, size: number) => {
  let current = source;
  while (current.width >= size * 2 && current.height >= size * 2) {
    const half = createCanvas(Math.ceil(current.width / 2), Math.ceil(current.height / 2));
    getContext(half).drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }
  return current;
};

/** The item (2D canvas) scaled to fit a square icon of `pixels`, centred, with a margin. */
const fitToIcon = (item: HTMLCanvasElement, pixels: number, margin: number) => {
  const room = pixels * (1 - margin * 2);
  const scale = room / Math.max(item.width, item.height);
  const width = Math.max(1, Math.round(item.width * scale));
  const height = Math.max(1, Math.round(item.height * scale));
  const icon = createCanvas(pixels, pixels);
  const left = Math.round((pixels - width) / 2);
  const top = Math.round((pixels - height) / 2);
  getContext(icon).drawImage(halveTowards(item, Math.max(width, height)), left, top, width, height);
  return icon;
};

/**
 * PNG data URLs of the icon at every scale (1x, 2x): the rendered item on its transparent
 * background, trimmed to its opaque pixels (`trim`), or the whole drawing (tiles).
 */
export const toIconFiles = (source: HTMLCanvasElement, trim: boolean) => {
  const whole = copyRegion(source, getWholeBounds(source));
  const item = trim ? copyRegion(whole, findOpaqueBounds(whole)) : whole;
  const margin = trim ? MARGIN : 0;
  return ICON_SCALES.map((scale) =>
    fitToIcon(item, ICON_SIZE * scale, margin).toDataURL("image/webp", 1)
  );
};
