/** Minimal node stand-ins for `document.createElement("canvas")` and its 2D context. */
export interface FakeImage {
  naturalHeight: number;
  naturalWidth: number;
  pixels: Uint8ClampedArray;
}

interface FakeDrawCall {
  args: number[];
  source: unknown;
}

interface FakeContext {
  draws: FakeDrawCall[];
  fills: { rect: number[]; style: string }[];
  pixels: Uint8ClampedArray;
  strokes: number;
}

export interface FakeCanvas {
  context: FakeContext;
  height: number;
  width: number;
}

const createContext = (canvas: { height: number; width: number }) => {
  const state: FakeContext = { draws: [], fills: [], pixels: new Uint8ClampedArray(0), strokes: 0 };
  const api = {
    beginPath: () => {},
    bezierCurveTo: () => {},
    clearRect: () => {},
    drawImage: (source: FakeImage | FakeCanvas, ...args: number[]) => {
      state.draws.push({ args, source });
      if ("pixels" in source) state.pixels = source.pixels.slice();
    },
    fillRect: (...rect: number[]) => { state.fills.push({ rect, style: api.fillStyle }); },
    fillStyle: "",
    getImageData: () => ({
      data: state.pixels.length ? state.pixels : new Uint8ClampedArray(canvas.width * canvas.height * 4)
    }),
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    moveTo: () => {},
    putImageData: (image: { data: Uint8ClampedArray }) => { state.pixels = image.data.slice(); },
    stroke: () => { state.strokes++; },
    strokeStyle: ""
  };
  return { api, state };
};

/** Returns a fake `document` plus every canvas it created, in creation order. */
export const createFakeCanvasDocument = () => {
  const canvases: FakeCanvas[] = [];
  const createElement = (tag: string) => {
    if (tag !== "canvas") throw new Error(`Unexpected element ${tag}`);
    const canvas = { height: 300, width: 300 } as FakeCanvas & { getContext: () => unknown };
    const { api, state } = createContext(canvas);
    canvas.context = state;
    canvas.getContext = () => api;
    canvases.push(canvas);
    return canvas;
  };
  return { canvases, document: { createElement } };
};

/** A square image whose opaque pixels fill the given inclusive rectangle with one colour. */
export const createFakeImage = (
  size: number, rect: { bottom: number; left: number; right: number; top: number }, rgb: number[]
): FakeImage => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = rect.top; y <= rect.bottom; y++)
    for (let x = rect.left; x <= rect.right; x++) pixels.set([...rgb, 255], (y * size + x) * 4);
  return { naturalHeight: size, naturalWidth: size, pixels };
};
