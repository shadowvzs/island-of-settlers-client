import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { createFinishedMillSailTexture } from "./mill-sail-cloth";
import type { MillSailPoint } from "./mill-sail-finish";

const clothColour = (nation: Exclude<WorkerNation, "roman">, u: number, v: number): [number, number, number] => {
  const warp = Math.cos(u * Math.PI * 192) * 4, weft = Math.cos(v * Math.PI * 192) * 4;
  const shade = warp + weft;
  if (nation === "chinese") {
    const dx = Math.min(u, 1 - u);
    const cloud = Math.abs(Math.hypot(dx / .10, (v - .50) / .045) - 1) < .13 ||
      Math.abs(Math.hypot((dx - .065) / .035, (v - .515) / .032) - 1) < .17;
    return cloud ? [168 + shade, 53 + shade, 36 + shade] : [228 + shade, 218 + shade, 191 + shade];
  }
  if (nation === "nubian") {
    const zigzag = .45 + Math.abs((u * 6 % 1) * 2 - 1) * .12;
    if (Math.abs(v - zigzag) < .012) return [76 + shade, 115 + shade, 139 + shade];
    return [233 + shade, 220 + shade, 190 + shade];
  }
  if (nation === "persian") {
    const band = Math.abs(Math.sin(v * Math.PI * 6)) < .06;
    return band ? [86 + shade, 114 + shade, 137 + shade] : [231 + shade, 218 + shade, 189 + shade];
  }
  if (nation === "japanese") {
    const binding = Math.abs(v - .78) < .008 || Math.abs(v - .83) < .004;
    return binding ? [88 + shade, 106 + shade, 128 + shade] : [237 + shade, 233 + shade, 213 + shade];
  }
  if (nation === "maya") {
    const step = .55 + Math.floor(u * 12) % 3 * .025;
    if (Math.abs(v - step) < .010) return [72 + shade, 132 + shade, 122 + shade];
    return [234 + shade, 221 + shade, 192 + shade];
  }
  if (nation === "indigenous") {
    const border = Math.min(u, 1 - u, v, 1 - v) < .035;
    if (border) return [102 + shade, 58 + shade, 35 + shade];
    const wave = .65 + Math.sin(u * Math.PI * 10) * .025;
    if (Math.abs(v - wave) < .014) return [157 + shade, 77 + shade, 49 + shade];
    return [232 + shade, 218 + shade, 191 + shade];
  }
  return [230 + shade, 221 + shade, 198 + shade];
};

/** Lightweight woven sails with restrained dyed patterns and no dashed stitching. */
export const createNationalMillSailTexture = (nation: Exclude<WorkerNation, "roman">, detailed: boolean,
  outline: readonly MillSailPoint[] = [[0, 0], [1, 0], [1, 1], [0, 1]]) =>
  createFinishedMillSailTexture(outline, detailed, (u, v) => clothColour(nation, u, v), nation,
    nation !== "viking");
