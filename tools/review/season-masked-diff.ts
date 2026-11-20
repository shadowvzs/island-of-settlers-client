import { readFileSync, writeFileSync } from "node:fs";
import type { Browser } from "playwright-core";

import { DIFF_THRESHOLD } from "../bench/parity-helpers";

/** The four frames of one masked diff: the reference and the season look, each with and without buildings. */
export interface MaskedDiffFiles {
  after: string;
  afterBare: string;
  before: string;
  beforeBare: string;
}

export interface MaskedDiffStats {
  /** Building pixels (reference with vs without buildings differ) that changed with the look (must be 0). */
  buildingChanged: number;
  /** The largest channel change on those pixels. */
  buildingMaxChannel: number;
  buildingPixels: number;
  /** Any changed pixel of the whole frame (vegetation, its shadows). */
  framePixelsChanged: number;
}

/**
 * Masked season diff (plan 11.2). Building pixels are where the reference frame with and without buildings
 * differ by more than DIFF_THRESHOLD. A building pixel counts as changed when the season frame differs there
 * while the building-free frames do not (vegetation in front of or behind a building changes in the bare pair
 * too, so it is excluded). The image: grey frame, building pixels blue, vegetation changes green, changed
 * building pixels red.
 */
export const writeMaskedDiff = async (browser: Browser, files: MaskedDiffFiles, output: string) => {
  const page = await browser.newPage();
  try {
    await page.setContent("<canvas id='diff'></canvas>");
    await page.evaluate("globalThis.__name = (value) => value;");
    const urls = Object.fromEntries(Object.entries(files).map(([key, path]) =>
      [key, `data:image/png;base64,${readFileSync(path).toString("base64")}`])) as unknown as MaskedDiffFiles;
    const result = await page.evaluate(async ({ sources, threshold }) => {
      const load = (url: string) => new Promise<HTMLImageElement>((done, fail) => {
        const image = new Image();
        image.onload = () => done(image);
        image.onerror = fail;
        image.src = url;
      });
      const images = await Promise.all([sources.before, sources.beforeBare, sources.after, sources.afterBare]
        .map(load));
      const { height, width } = images[0]!;
      const pixelsOf = (image: HTMLImageElement) => {
        const canvas = document.createElement("canvas");
        Object.assign(canvas, { height, width });
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const [before, beforeBare, after, afterBare] = images.map(pixelsOf) as [Uint8ClampedArray, Uint8ClampedArray,
        Uint8ClampedArray, Uint8ClampedArray];
      const delta = (a: Uint8ClampedArray, b: Uint8ClampedArray, index: number) => Math.max(
        Math.abs(a[index]! - b[index]!), Math.abs(a[index + 1]! - b[index + 1]!), Math.abs(a[index + 2]! - b[index + 2]!));
      const output = new ImageData(width, height);
      let buildingPixels = 0, buildingChanged = 0, buildingMaxChannel = 0, framePixelsChanged = 0;
      for (let index = 0; index < before.length; index += 4) {
        const building = delta(before, beforeBare, index) > threshold;
        const vegetation = delta(beforeBare, afterBare, index) > 0;
        const change = delta(before, after, index);
        if (change > 0) framePixelsChanged++;
        const grey = (after[index]! + after[index + 1]! + after[index + 2]!) / 6;
        let colour = [grey, grey, grey];
        if (building) colour = [grey * 0.6, grey * 0.6, 120 + grey * 0.5];
        if (change > 0 && vegetation) colour = [grey * 0.4, 200, grey * 0.4];
        if (building) buildingPixels++;
        if (building && !vegetation && change > 0) {
          buildingChanged++;
          buildingMaxChannel = Math.max(buildingMaxChannel, change);
          colour = [255, 0, 0];
        }
        output.data.set([...colour, 255], index);
      }
      const canvas = document.getElementById("diff") as HTMLCanvasElement;
      Object.assign(canvas, { height, width });
      canvas.getContext("2d")!.putImageData(output, 0, 0);
      return { stats: { buildingChanged, buildingMaxChannel, buildingPixels, framePixelsChanged },
        url: canvas.toDataURL("image/png") as string };
    }, { sources: urls, threshold: DIFF_THRESHOLD });
    writeFileSync(output, Buffer.from(result.url.split(",")[1]!, "base64"));
    return result.stats satisfies MaskedDiffStats;
  } finally {
    await page.close();
  }
};
