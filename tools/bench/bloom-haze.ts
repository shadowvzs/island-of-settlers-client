import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { RawShot } from "./frozen-frame-review";

/**
 * Bloom haze measure (BLOOM-REFINEMENT), used by bloom-review.ts for every pair. Run directly to add
 * it to an earlier review directory: `HAZE_DIR=<output dir> npx tsx tools/bench/bloom-haze.ts`.
 */
/** Distance (pixels) from any bright source beyond which a change counts as haze. */
const HAZE_DISTANCE = 160;
/** Cell size of the dilated bright mask (pixels). */
const HAZE_CELL = 16;

/**
 * Haze measure for the no-veil gate: the mean relative luminance change of the non-bright pixels
 * (max channel < 128) that lie farther than HAZE_DISTANCE from every bright pixel (max >= 230) of the
 * reference frame. A halo around the sun or a window is meant to lift its surroundings; a veil over
 * the whole frame shows up here.
 */
export const hazeStats = (off: RawShot, on: RawShot) => {
  const { height: shotHeight, width: shotWidth } = off;
  const cellsX = Math.ceil(shotWidth / HAZE_CELL), cellsY = Math.ceil(shotHeight / HAZE_CELL);
  const bright = new Uint8Array(cellsX * cellsY);
  const brightness = (pixels: Uint8Array, index: number) =>
    Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!);
  for (let y = 0; y < shotHeight; y++) for (let x = 0; x < shotWidth; x++)
    if (brightness(off.pixels, (y * shotWidth + x) * 4) >= 230)
      bright[Math.floor(y / HAZE_CELL) * cellsX + Math.floor(x / HAZE_CELL)] = 1;
  const reach = Math.ceil(HAZE_DISTANCE / HAZE_CELL);
  const near = new Uint8Array(cellsX * cellsY);
  for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
    if (!bright[cy * cellsX + cx]) continue;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < cellsX && ny < cellsY && dx * dx + dy * dy <= reach * reach)
        near[ny * cellsX + nx] = 1;
    }
  }
  const luma = (pixels: Uint8Array, index: number) =>
    pixels[index]! * 0.2126 + pixels[index + 1]! * 0.7152 + pixels[index + 2]! * 0.0722;
  let count = 0, before = 0, after = 0;
  for (let y = 0; y < shotHeight; y++) for (let x = 0; x < shotWidth; x++) {
    const index = (y * shotWidth + x) * 4;
    if (near[Math.floor(y / HAZE_CELL) * cellsX + Math.floor(x / HAZE_CELL)]) continue;
    if (brightness(off.pixels, index) >= 128) continue;
    count++;
    before += luma(off.pixels, index);
    after += luma(on.pixels, index);
  }
  return { hazePercent: before > 0 ? (after / before - 1) * 100 : 0, hazePixels: count };
};

/** Adds `hazePercent` / `hazePixels` to every Off/On pair of an earlier report. */
const addHazeToReport = (directory: string) => {
  const reportPath = resolve(directory, "report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const sizes = new Map<string, { height: number; width: number }>(
    report.shots.map((shot: { height: number; name: string; width: number }) => [shot.name, shot]));
  for (const pair of report.pairs) {
    const size = sizes.get(`${pair.name}-on`);
    if (!size) continue;
    const read = (suffix: string): RawShot => ({
      ...size, pixels: new Uint8Array(readFileSync(resolve(directory, `${pair.name}-${suffix}.rgba`)))
    });
    Object.assign(pair.diff, hazeStats(read("off"), read("on")));
    console.log(pair.name, pair.diff.hazePercent.toFixed(2));
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
};

if (process.env.HAZE_DIR) addHazeToReport(resolve(process.env.HAZE_DIR));
