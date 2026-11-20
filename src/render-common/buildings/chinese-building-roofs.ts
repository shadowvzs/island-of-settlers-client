import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { CHINESE_ROOF_PURLIN_SHARE } from "./chinese-harbour-roof";
import { addChineseRidgeFinial } from "./chinese-ridge-finial";
import type { RoofEnvelope } from "./nation-kit-classify";
import { type Add, envelopeCenter, envelopeSize, runBetween } from "./nation-kit-parts";
import { getOccupationRoofHeight } from "./occupation-roof-height";

export const CHINESE_TIMBER: Point3 = [.1248, .0369, .0307];
const CHINESE_GOLD: Point3 = [.66, .47, .22];
const HIP_ROOF_IDS = new Set([0, 2, 9, 14, 24, 29, 34, 39, 40, 58, 59, 62]);
const GABLE_ROOF_IDS = new Set([10, 11, 12, 13, 17, 19, 20, 25, 26, 27, 33, 36]);
const LOW_ROOF_IDS = new Set([5, 8, 18, 21, 23, 28, 37, 57]);

/** Prestigious halls use glazed roof tiles; production roofs keep the grey slate finish. */
export const chineseRoofSurface = (monumental: boolean): BuildingPart["surface"] =>
  monumental ? "roof" : "roof-slate";

/** Service sheds, workshops and ceremonial halls have visibly different roof construction. */
export const chineseRoofProfile = (id: number): NonNullable<BuildingPart["occupationRoof"]> => {
  if (id === 4 || id === 14) return "pyramid";
  if (HIP_ROOF_IDS.has(id)) return "hip";
  if (GABLE_ROOF_IDS.has(id)) return "gable";
  return "half-hip";
};

/** Layered corbel arms transfer eave loads to a real post/wall head; they are not floating ornaments. */
export const addChineseBracket = (add: Add, position: Point3, yaw: number, detailed: boolean, scale = 1,
  frontLimit = Infinity) => {
  const [x, y, z] = position;
  const point = (along: number, up: number, out = 0): Point3 =>
    [x + Math.cos(yaw) * along + Math.sin(yaw) * out, y + up, z - Math.sin(yaw) * along + Math.cos(yaw) * out];
  const timber = (at: Point3, size: Point3, turn = yaw) => {
    const part: BuildingPart = { position: at, rotation: [0, turn, 0],
      shape: detailed ? "bevel-box" : "box", size, stage: 2, surface: "paint", tint: CHINESE_TIMBER };
    const excess = Number.isFinite(frontLimit) ? getRomanPartBounds(part).max[2] - frontLimit : 0;
    if (excess > 0) {
      // Shorten only the projecting tip; the end bearing on its post remains in place.
      const axis = Math.abs(Math.sin(turn)) > .5 ? 0 : 2;
      if (excess >= size[axis]) return;
      part.size = [...size]; part.size[axis] -= excess;
      part.position = [at[0], at[1], at[2] - excess / 2];
    }
    add(part);
  };
  timber(point(0, 0), [.14 * scale, .065 * scale, .12 * scale]);
  timber(point(0, .06 * scale), [.27 * scale, .055 * scale, .075 * scale]);
  if (!detailed) return;
  for (const side of [-1, 1]) {
    timber(point(side * .1 * scale, .102 * scale), [.065 * scale, .04 * scale, .09 * scale]);
    timber(point(side * .1 * scale, .137 * scale), [.15 * scale, .035 * scale, .065 * scale]);
  }
  timber(point(0, .1 * scale, .03 * scale), [.07 * scale, .055 * scale, .23 * scale]);
};

/** Broad Chinese roof with straight structural ridge, ceramic end pieces and exposed eave purlins. */
export const addChineseRoof = (add: Add, roof: RoofEnvelope, id: number, detailed: boolean,
  monumental = false, profileOverride?: NonNullable<BuildingPart["occupationRoof"]>,
  purlinShares: readonly [number, number] = [CHINESE_ROOF_PURLIN_SHARE, CHINESE_ROOF_PURLIN_SHARE]) => {
  const surface = chineseRoofSurface(monumental);
  const extent = envelopeSize(roof), base = envelopeCenter(roof);
  const turned = extent.width > extent.depth;
  const width = Math.min(extent.width, extent.depth), length = Math.max(extent.width, extent.depth);
  let profile = profileOverride ?? chineseRoofProfile(id);
  if (id === 39 && length < 1.35 && base[1] > 2) profile = "pyramid";
  const pointed = profile === "pyramid";
  let pitch = profile === "gable" ? .46 : .35;
  if (pointed) pitch = .59;
  if (LOW_ROOF_IDS.has(id)) pitch = .29;
  const height = Math.max(.2, Math.min(monumental ? 1.1 : .85, width * pitch));
  const centreY = base[1] + height * .44;
  const roofPart: BuildingPart = { occupationRoof: profile, roofSweep: monumental ? .35 : .3,
    roofCurve: pointed ? .85 : .62, roofTiles: "pan-cover",
    roofTileSpacing: id === 59 ? 2.1 : undefined,
    position: [base[0], centreY, base[2]],
    rotation: turned ? [0, Math.PI / 2, 0] : undefined, shape: "occupation-roof",
    size: [width, height, length], stage: 3, surface };
  add(roofPart);
  const point = (u: number, v: number, lift = 0): Point3 => {
    const roofHeight = Math.min(.495, getOccupationRoofHeight(profile, u, v, roofPart.roofSweep, roofPart.roofCurve));
    const y = centreY + roofHeight * height + lift;
    if (turned) return [base[0] + v * length, y, base[2] - u * width];
    return [base[0] + u * width, y, base[2] + v * length];
  };
  let ridgeEnd = profile === "gable" ? .49 : .285;
  if (pointed) ridgeEnd = 0;
  if (!pointed) {
    // A straight beam bridges the dipped middle of a swept gable ridge.
    const segments = profile === "gable" ? (detailed ? 6 : 4) : 1;
    for (let index = 0; index < segments; index++) {
      const from = ridgeEnd * (2 * index / segments - 1);
      const to = ridgeEnd * (2 * (index + 1) / segments - 1);
      runBetween(add, point(0, from, .018), point(0, to, .018), [.065, .065],
        { shape: "bevel-box", stage: 4, surface });
    }
  }
  // Ceramic ridge ends are short swallow-tail forms rather than Japanese upturned corner spires.
  for (const side of pointed ? [1] : [-1, 1]) {
    const at = point(0, side * ridgeEnd, .06);
    add({ position: at, rotation: turned ? [0, Math.PI / 2, 0] : undefined,
      shape: "bevel-box", size: [.08, .14, .1], stage: 4, surface });
    if (detailed && monumental && width > .75 && !pointed)
      addChineseRidgeFinial(add, point(0, side * ridgeEnd, .08),
        (turned ? Math.PI / 2 : 0) + (side < 0 ? Math.PI : 0), surface);
    if (detailed) add({ position: [at[0], at[1] + .07, at[2]],
      radialSegments: 8, shape: "sphere", size: [.075, .065, .075], stage: 4, surface });
  }
  const segments = detailed ? 6 : 3;
  for (const side of [-1, 1]) for (let segment = 0; segment < segments; segment++) {
    const from = -.46 + .92 * segment / segments, to = -.46 + .92 * (segment + 1) / segments;
    const share = side * purlinShares[side < 0 ? 0 : 1];
    runBetween(add, point(share, from, -.075), point(share, to, -.075), [.055, .065],
      { roofSupport: true, stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  }
  if (profile === "gable") {
    add({ occupationRoof: profile, roofSweep: roofPart.roofSweep, roofCurve: roofPart.roofCurve,
      position: [base[0], centreY - .005, base[2]],
      rotation: turned ? [0, Math.PI / 2, 0] : undefined,
      roofInfillRatio: [.92, .91], shape: "roof-infill", size: [width * .92, height, length * .91],
      stage: 2, surface: "planks" });
    if (detailed) for (const side of [-1, 1])
      runBetween(add, point(-.45, side * .455, -.045), point(.45, side * .455, -.045), [.045, .045],
        { roofSupport: true, stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  }
  if (!detailed || !monumental) return;
  // Small gilt collars are confined to prestigious halls; ordinary production roofs stay grey.
  for (const side of [-1, 1]) {
    const at = point(0, side * ridgeEnd, .025);
    add({ position: at, shape: "bevel-box", size: [.1, .035, .045],
      stage: 4, surface: "paint", tint: CHINESE_GOLD });
  }
};
