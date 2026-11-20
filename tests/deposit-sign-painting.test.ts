import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ImageLoader, SRGBColorSpace } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDepositSignPaintings, DEPOSIT_BOARD_PAINT } from "../src/renderers/three/settlement/deposit-sign-painting";
import { ORE, type Ore } from "../src/shared/world/world-data";
import {
  createFakeCanvasDocument, createFakeImage, type FakeCanvas, type FakeImage
} from "./helpers/fake-canvas-dom";

const PAINTED_ORES = [ORE.coal, ORE.iron, ORE.gold, ORE.granite] as const;
/** Each fake source illustration has its opaque ore in a different place and colour. */
const IMAGE_BY_ORE: Record<number, FakeImage> = {
  [ORE.coal]: createFakeImage(64, { bottom: 50, left: 10, right: 40, top: 20 }, [20, 22, 25]),
  [ORE.iron]: createFakeImage(64, { bottom: 40, left: 5, right: 60, top: 30 }, [140, 90, 70]),
  [ORE.gold]: createFakeImage(64, { bottom: 63, left: 0, right: 63, top: 0 }, [230, 190, 40]),
  [ORE.granite]: createFakeImage(64, { bottom: 33, left: 30, right: 33, top: 30 }, [150, 150, 152])
};

let fake: ReturnType<typeof createFakeCanvasDocument>;
let loads: { onLoad: (image: FakeImage) => void; url: string }[];

const oreFromUrl = (url: string) => {
  if (url.includes("coal.png")) return ORE.coal;
  if (url.includes("ironOre.png")) return ORE.iron;
  if (url.includes("goldOre.png")) return ORE.gold;
  return ORE.granite;
};
const loadAll = () => { for (const { onLoad, url } of loads) onLoad(IMAGE_BY_ORE[oreFromUrl(url)]!); };
const canvasOf = (material: { map: { image: unknown } | null }) => material.map!.image as FakeCanvas;

beforeEach(() => {
  fake = createFakeCanvasDocument();
  loads = [];
  vi.stubGlobal("document", fake.document);
  vi.spyOn(ImageLoader.prototype, "load").mockImplementation(((url: string, onLoad: (image: FakeImage) => void) => {
    loads.push({ onLoad, url });
  }) as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("deposit sign ore paintings", () => {
  it("loads a distinct, existing shaded ore illustration per painted ore", () => {
    const paintings = createDepositSignPaintings();
    for (const ore of PAINTED_ORES) paintings.materialFor(ore);
    const urls = loads.map(load => load.url);
    expect(new Set(urls).size).toBe(PAINTED_ORES.length);
    for (const url of urls) {
      const path = fileURLToPath(url);
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(1000);
    }
    paintings.dispose();
  });

  it("shares one transparent sRGB board-ratio material per ore and none for barren ground", () => {
    const paintings = createDepositSignPaintings();
    const materials = PAINTED_ORES.map(ore => paintings.materialFor(ore));
    expect(new Set(materials).size).toBe(PAINTED_ORES.length);
    expect(paintings.materialFor(ORE.iron)).toBe(materials[1]);
    for (const material of materials) {
      expect(material.map!.colorSpace).toBe(SRGBColorSpace);
      expect(material).toMatchObject({ alphaTest: .05, depthWrite: false, transparent: true });
      expect(canvasOf(material)).toMatchObject({ height: 184, width: 256 });
      // Same ratio as the 0.46 x 0.33 painted board face, so the ore keeps its proportions.
      expect(256 / 184).toBeCloseTo(.46 / .33, 2);
    }
    expect(loads).toHaveLength(PAINTED_ORES.length);
    paintings.materialFor(ORE.none as Ore);
    expect(loads).toHaveLength(PAINTED_ORES.length);
    paintings.dispose();
  });

  it("paints each ore cropped to its opaque bounds, centred, keylined, posterised, on timber paint", () => {
    const paintings = createDepositSignPaintings();
    const materials = PAINTED_ORES.map(ore => paintings.materialFor(ore));
    const versions = materials.map(material => material.map!.version);
    loadAll();
    const crops = new Set<string>();
    PAINTED_ORES.forEach((ore, index) => {
      const material = materials[index]!;
      expect(material.map!.version).toBeGreaterThan(versions[index]!);
      const { context } = canvasOf(material);
      expect(context.draws).toHaveLength(5);
      const [sx, sy, sw, sh, dx, dy, dw, dh] = context.draws.at(-1)!.args as number[];
      crops.add(`${sx},${sy},${sw},${sh}`);
      const image = IMAGE_BY_ORE[ore]!;
      expect(sw! * sh!).toBeGreaterThan(0);
      expect(sx! + sw!).toBeLessThanOrEqual(image.naturalWidth);
      expect(sy! + sh!).toBeLessThanOrEqual(image.naturalHeight);
      // Fits inside the ore's paint area, centred on the 256 x 184 board texture.
      const paint = DEPOSIT_BOARD_PAINT[ore]!;
      expect(dw!).toBeLessThanOrEqual(paint.width + .0001); expect(dh!).toBeLessThanOrEqual(paint.height + .0001);
      expect(Math.max(dw! / paint.width, dh! / paint.height)).toBeCloseTo(1, 5);
      expect(dx! + dw! / 2).toBeCloseTo(128, 5); expect(dy! + dh! / 2).toBeCloseTo(92, 5);
      expect(context.fills.map(fill => fill.style)).toEqual(["#cbb77d", paint.board]);
      expect(context.strokes).toBeGreaterThan(10);
      const source = context.draws[0]!.source as FakeCanvas;
      const opaque = [...source.context.pixels].filter((_, i) => i % 4 < 3 && source.context.pixels[i - i % 4 + 3]);
      expect(opaque.length).toBeGreaterThan(0);
      for (const value of opaque) expect(value % 17).toBe(0);
    });
    expect(crops.size).toBe(PAINTED_ORES.length);
    expect([...crops]).toContain("10,20,31,31");
    paintings.dispose();
  });

  it("paints the dark coal, iron and gold lumps on pale limewash with a margin, granite on timber", () => {
    const luminance = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
      .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index]!, 0);
    const granite = DEPOSIT_BOARD_PAINT[ORE.granite]!;
    expect(granite).toMatchObject({ board: "#e7d0a0", height: 162, width: 230 });
    for (const ore of [ORE.coal, ORE.iron, ORE.gold]) {
      const paint = DEPOSIT_BOARD_PAINT[ore]!;
      expect(luminance(paint.board)).toBeGreaterThan(luminance(granite.board) + 15);
      expect(paint.width).toBeLessThanOrEqual(256 * .8);
      expect(paint.height).toBeLessThanOrEqual(184 * .8);
    }
  });

  it("ignores illustrations that finish loading after disposal and releases textures", () => {
    const paintings = createDepositSignPaintings();
    const material = paintings.materialFor(ORE.gold);
    const disposeMap = vi.spyOn(material.map!, "dispose");
    paintings.dispose();
    loadAll();
    expect(disposeMap).toHaveBeenCalled();
    expect(canvasOf(material).context.draws).toHaveLength(0);
  });
});
