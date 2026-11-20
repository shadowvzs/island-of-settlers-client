import { drawCowhide, drawTomoe } from "./military-equipment-parts";
import { paintIndigenousHide } from "./military-hide-paint";

/**
 * One painted atlas for every nation's issued equipment, so the whole armoury shares one texture
 * and one material. Regions are in pixels of the 512 px master; geometry UVs index into them.
 * The texture's alpha is the livery mask: 0 = dyed in the soldier's faction colour (the grey
 * value then shades the dye), 1 = the painted colour itself.
 */
export const ATLAS_SIZE = 512;
export const ATLAS_REGIONS = {
  indigenousHide: [416, 384, 96, 128],
  japaneseTate: [164, 0, 170, 284],
  nubianHide: [338, 0, 170, 298],
  romanScutum: [0, 0, 160, 276],
  vikingBoards: [0, 300, 212, 212],
  /** Plain white: vertex colours alone. */
  white: [440, 330, 48, 48],
  wood: [216, 300, 200, 212]
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type AtlasRegion = keyof typeof ATLAS_REGIONS;

type Context = CanvasRenderingContext2D;
type Rect = readonly [number, number, number, number];
interface Layers { color: Context; dye: Context }

/** Fills an ellipse inscribed in a region-relative rectangle. */
const ellipse = (context: Context, rect: Rect, inset: number) => {
  const [left, top, width, height] = rect;
  context.beginPath();
  context.ellipse(left + width / 2, top + height / 2, width / 2 - inset, height / 2 - inset, 0, 0, Math.PI * 2);
};

/** Livery field with a painted bronze border, winged thunderbolts and a laurel ring round the boss. */
const paintScutum = ({ color, dye }: Layers, [left, top, width, height]: Rect) => {
  color.fillStyle = "#f2f2f2";
  color.fillRect(left, top, width, height);
  dye.fillStyle = "#fff";
  dye.fillRect(left, top, width, height);
  color.strokeStyle = "#d8b25a";
  color.lineWidth = 7;
  color.strokeRect(left + 9, top + 9, width - 18, height - 18);
  dye.fillStyle = "#000";
  dye.fillRect(left + 5, top + 5, width - 10, 8);
  dye.fillRect(left + 5, top + height - 13, width - 10, 8);
  dye.fillRect(left + 5, top + 5, 8, height - 10);
  dye.fillRect(left + width - 13, top + 5, 8, height - 10);
  const centerX = left + width / 2, centerY = top + height / 2;
  for (const side of [-1, 1]) {
    for (const vertical of [-1, 1]) {
      const bolt = [[.12, .1], [.32, .42], [.2, .38], [.36, .8], [.06, .3], [.18, .34]] as const;
      for (const layer of [color, dye]) {
        layer.fillStyle = layer === color ? "#e0b552" : "#000";
        layer.beginPath();
        for (const [x, y] of bolt)
          layer.lineTo(centerX + side * x * width * .5, centerY + vertical * y * height * .4);
        layer.fill();
      }
    }
  }
  for (const layer of [color, dye]) {
    layer.strokeStyle = layer === color ? "#d9ae4e" : "#000";
    layer.lineWidth = 5;
    layer.beginPath();
    layer.arc(centerX, centerY, width * .2, 0, Math.PI * 2);
    layer.stroke();
  }
  color.fillStyle = "#c7953f";
  color.beginPath();
  color.arc(centerX, centerY, width * .13, 0, Math.PI * 2);
  color.fill();
  color.fillStyle = "#f4d58a";
  color.beginPath();
  color.arc(centerX - width * .03, centerY - width * .03, width * .05, 0, Math.PI * 2);
  color.fill();
};

/** Eight radial segments, alternately livery and limewash, on vertical linden boards. */
const paintVikingBoards = ({ color, dye }: Layers, rect: Rect) => {
  const [left, top, width, height] = rect;
  const centerX = left + width / 2, centerY = top + height / 2, radius = width / 2;
  color.fillStyle = "#ece0c0";
  color.fillRect(left, top, width, height);
  dye.fillStyle = "#000";
  dye.fillRect(left, top, width, height);
  for (let segment = 0; segment < 8; segment += 2) {
    const start = segment / 8 * Math.PI * 2 + .2;
    for (const layer of [color, dye]) {
      layer.fillStyle = layer === color ? "#efefef" : "#fff";
      layer.beginPath();
      layer.moveTo(centerX, centerY);
      layer.arc(centerX, centerY, radius, start, start + Math.PI / 4);
      layer.fill();
    }
  }
  color.fillStyle = "rgba(40,24,12,.28)";
  for (let board = 1; board < 7; board++) color.fillRect(left + board * width / 7, top, 2, height);
  color.strokeStyle = "#5a3a20";
  color.lineWidth = 10;
  ellipse(color, rect, 5);
  color.stroke();
  dye.strokeStyle = "#000";
  dye.lineWidth = 12;
  ellipse(dye, rect, 5);
  dye.stroke();
  color.fillStyle = "#3b3f45";
  for (let rivet = 0; rivet < 16; rivet++) {
    const angle = rivet / 16 * Math.PI * 2;
    color.beginPath();
    color.arc(centerX + Math.cos(angle) * radius * .86, centerY + Math.sin(angle) * radius * .86, 3, 0, Math.PI * 2);
    color.fill();
  }
  color.fillStyle = "#4b5058";
  color.beginPath();
  color.arc(centerX, centerY, radius * .3, 0, Math.PI * 2);
  color.fill();
};

/** Cowhide with a dark wooden spine and a dyed rawhide lacing round the rim. */
const paintNubianHide = ({ color, dye }: Layers, rect: Rect) => {
  const [left, top, width, height] = rect;
  drawCowhide(color, rect, width / height, 1.8);
  dye.fillStyle = "#000";
  dye.fillRect(left, top, width, height);
  color.fillStyle = "#4a2d18";
  color.fillRect(left + width / 2 - 6, top + 10, 12, height - 20);
  for (const layer of [color, dye]) {
    layer.strokeStyle = layer === color ? "#e8e8e8" : "#fff";
    layer.lineWidth = 13;
    layer.setLineDash([9, 4]);
    ellipse(layer, rect, 9);
    layer.stroke();
    layer.setLineDash([]);
  }
  color.strokeStyle = "#6a3a1e";
  color.lineWidth = 5;
  ellipse(color, rect, 2);
  color.stroke();
};

/** Three dark planks, lacquered top and bottom bars, iron bands and a dyed tomoe mon. */
const paintTate = ({ color, dye }: Layers, rect: Rect) => {
  const [left, top, width, height] = rect;
  color.fillStyle = "#3e2716";
  color.fillRect(left, top, width, height);
  dye.fillStyle = "#000";
  dye.fillRect(left, top, width, height);
  for (let board = 0; board < 3; board++) {
    color.fillStyle = board % 2 ? "#6a4528" : "#5f3d22";
    color.fillRect(left + board * width / 3 + 2, top, width / 3 - 4, height);
  }
  color.fillStyle = "#17110f";
  color.fillRect(left, top, width, height * .07);
  color.fillRect(left, top + height * .93, width, height * .07);
  color.fillStyle = "#4d535b";
  for (const y of [.26, .74]) color.fillRect(left, top + height * y, width, height * .03);
  const center = [left + width / 2, top + height * .47] as const;
  drawTomoe(color, center, width * .3, { commas: "#e6e6e6", field: "#f3ead6" });
  drawTomoe(dye, center, width * .3, { commas: "#fff", field: "#000" });
};

/** Fine straight grain along the atlas V axis (the length of a haft or grip). */
const paintWood = ({ color, dye }: Layers, [left, top, width, height]: Rect) => {
  color.fillStyle = "#d9c4a0";
  color.fillRect(left, top, width, height);
  dye.fillStyle = "#000";
  dye.fillRect(left, top, width, height);
  for (let line = 0; line < 60; line++) {
    const x = left + (line * 37) % width;
    color.strokeStyle = line % 3 ? "rgba(70,42,17,.18)" : "rgba(255,240,205,.25)";
    color.lineWidth = line % 7 === 0 ? 1.6 : .7;
    color.beginPath();
    color.moveTo(x, top);
    for (let y = 0; y <= height; y += 10) color.lineTo(x + Math.sin(y * .04 + line) * 2, top + y);
    color.stroke();
  }
};

const paintWhite = ({ color, dye }: Layers, [left, top, width, height]: Rect) => {
  color.fillStyle = "#fff";
  color.fillRect(left, top, width, height);
  dye.fillStyle = "#000";
  dye.fillRect(left, top, width, height);
};

const PAINTERS: Record<AtlasRegion, (layers: Layers, rect: Rect) => void> = {
  indigenousHide: ({ color, dye }, rect) => {
    paintIndigenousHide(color, rect);
    dye.fillStyle = "#000";
    dye.fillRect(...rect);
  },
  japaneseTate: paintTate,
  nubianHide: paintNubianHide,
  romanScutum: paintScutum,
  vikingBoards: paintVikingBoards,
  white: paintWhite,
  wood: paintWood
};

const createLayer = (size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  return canvas;
};

/** Paints the master atlas and returns RGBA pixels at `size` (512 High, 256 Minimal). */
export const paintEquipmentAtlas = (size: number) => {
  const color = createLayer(ATLAS_SIZE), dye = createLayer(ATLAS_SIZE);
  const layers = { color: color.getContext("2d")!, dye: dye.getContext("2d")! };
  layers.color.fillStyle = "#fff";
  layers.color.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const [region, rect] of Object.entries(ATLAS_REGIONS))
    PAINTERS[region as AtlasRegion](layers, rect);
  const read = (source: HTMLCanvasElement) => {
    const target = createLayer(size), context = target.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(source, 0, 0, size, size);
    return context.getImageData(0, 0, size, size).data;
  };
  const pixels = read(color), mask = read(dye);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255 - mask[index - 3]!;
  return pixels;
};
