import { CanvasTexture, ImageLoader, MeshStandardMaterial, SRGBColorSpace } from "three";

import { ORE_ICON_SOURCES } from "../../../render-common/rocks/ore-icon-sources";
import { ORE, type Ore } from "../../../shared/world/world-data";

/** Board texture at the painted face's 0.46 x 0.33 ratio, so the ore is never squashed. */
const TEXTURE_WIDTH = 256, TEXTURE_HEIGHT = 184;
/** Board paint and the ore's maximum painted area on the board texture. */
interface DepositBoardPaint { readonly board: string; readonly height: number; readonly width: number }
/** Aged warm timber; light ores (granite) read clearly against it. */
const TIMBER_BOARD: DepositBoardPaint = { board: "#e7d0a0", height: 162, width: 230 };
/** Pale limewashed timber with a visible margin, so dark ore lumps never merge with the board. */
const LIMEWASHED_BOARD: DepositBoardPaint = { board: "#f4efe3", height: 140, width: 200 };
export const DEPOSIT_BOARD_PAINT: Partial<Record<Ore, DepositBoardPaint>> = {
  [ORE.coal]: LIMEWASHED_BOARD, [ORE.iron]: LIMEWASHED_BOARD,
  [ORE.gold]: LIMEWASHED_BOARD, [ORE.granite]: TIMBER_BOARD
};

/** Turn the canonical shaded ore illustration into warm, lightly posterised signboard pigment. */
const paintOre = (canvas: HTMLCanvasElement, image: HTMLImageElement, paint: DepositBoardPaint) => {
  const context = canvas.getContext("2d")!;
  const source = document.createElement("canvas");
  source.width = image.naturalWidth; source.height = image.naturalHeight;
  const brush = source.getContext("2d")!;
  brush.drawImage(image, 0, 0);
  const pixels = brush.getImageData(0, 0, source.width, source.height);
  let left = source.width, right = 0, top = source.height, bottom = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3]! < 50) continue;
    const pixel = i / 4, x = pixel % source.width, y = Math.floor(pixel / source.width);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    for (let channel = 0; channel < 3; channel++)
      pixels.data[i + channel] = Math.round(pixels.data[i + channel]! / 17) * 17;
  }
  brush.putImageData(pixels, 0, 0);
  if (right < left || bottom < top) return;
  const width = right - left + 1, height = bottom - top + 1;
  const scale = Math.min(paint.width / width, paint.height / height);
  const w = width * scale, h = height * scale, x = (TEXTURE_WIDTH - w) / 2,
    y = (TEXTURE_HEIGHT - h) / 2;
  context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  // A fine ochre keyline frames the ore as paint and lifts it off the board.
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]])
    context.drawImage(source, left, top, width, height, x + dx!, y + dy!, w, h);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = "#cbb77d"; context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  context.globalCompositeOperation = "source-over";
  context.drawImage(source, left, top, width, height, x, y, w, h);
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = paint.board; context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  context.globalCompositeOperation = "source-over";
  context.strokeStyle = "#7a5c3830";
  context.lineWidth = .65;
  for (let row = 9; row < TEXTURE_HEIGHT; row += 16) {
    context.beginPath(); context.moveTo(0, row);
    context.bezierCurveTo(80, row + 2, 175, row - 3, TEXTURE_WIDTH, row + 1); context.stroke();
  }
};

/** One flat painted texture per ore, shared by its signs and released with the renderer. */
export const createDepositSignPaintings = () => {
  const materials = new Map<Ore, MeshStandardMaterial>();
  let disposed = false;
  return {
    materialFor: (ore: Ore) => {
      const existing = materials.get(ore);
      if (existing) return existing;
      const canvas = document.createElement("canvas"); canvas.width = TEXTURE_WIDTH;
      canvas.height = TEXTURE_HEIGHT;
      const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
      const material = new MeshStandardMaterial({ alphaTest: .05, map: texture,
        roughness: 1, transparent: true, depthWrite: false });
      materials.set(ore, material);
      const source = ORE_ICON_SOURCES[ore], paint = DEPOSIT_BOARD_PAINT[ore] ?? TIMBER_BOARD;
      if (source) new ImageLoader().load(source, image => {
        if (disposed) return;
        paintOre(canvas, image, paint); texture.needsUpdate = true;
      });
      return material;
    },
    dispose: () => {
      disposed = true;
      for (const material of materials.values()) { material.map?.dispose(); material.dispose(); }
      materials.clear();
    }
  };
};
