import { indigenousClothDetail, indigenousHideDetail } from "./indigenous-surface-detail";
import { seamDistance, type SurfaceSampler } from "./surface-detail-common";

/** A few unequal repairs, rather than a repeating checkerboard or a decorative painted stripe. */
const PATCHES = [
  [.22, .62, .105, .13, .12], [.68, .38, .075, .10, -.17], [.81, .77, .09, .075, .09]
] as const;

export const indigenousPatchedCanvasDetail: SurfaceSampler = point => {
  const woven = indigenousClothDetail(point);
  for (const [index, [u, v, width, height, angle]] of PATCHES.entries()) {
    const dx = point.u - u, dy = point.v - v;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle);
    const y = dx * Math.sin(angle) + dy * Math.cos(angle);
    const edge = Math.min(width - Math.abs(x), height - Math.abs(y));
    if (edge < -.004) continue;
    const seam = Math.exp(-Math.abs(edge) * 650);
    const stitch = seam * Math.pow(Math.max(0, Math.cos((x + y) * Math.PI * 150)), 8);
    const inside = edge >= 0;
    const tint: [number, number, number] = index === 1 ? [.84, .87, .86] : [1.02, .95, .82];
    return {
      ...woven,
      brightness: woven.brightness * (inside ? .93 + index * .025 : 1) - seam * .12 + stitch * .1,
      colour: inside ? tint : woven.colour,
      height: woven.height + (inside ? .018 : 0) - seam * .025 + stitch * .035
    };
  }
  return woven;
};

/** Woven cover reinforced with narrow sewn leather hems and panel bindings. */
export const indigenousLeatherCanvasDetail: SurfaceSampler = point => {
  const woven = indigenousClothDetail(point);
  const edge = Math.min(point.v, 1 - point.v);
  const panel = seamDistance(point.u * 3);
  const hem = edge < .045, binding = panel < .014;
  if (!hem && !binding) return woven;
  const leather = indigenousHideDetail(point);
  const seamEdge = hem ? Math.abs(edge - .032) : Math.abs(panel - .008);
  const along = hem ? point.u : point.v;
  const stitch = Math.exp(-seamEdge * 900)
    * Math.pow(Math.max(0, Math.cos(along * Math.PI * 160)), 10);
  return {
    brightness: leather.brightness * .86 + stitch * .15,
    colour: [1, .78, .53],
    height: leather.height + .025 + stitch * .035,
    roughness: leather.roughness
  };
};
