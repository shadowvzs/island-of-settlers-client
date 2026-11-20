import type { CampCanvasShape } from "../../../render-common/adventure/adventure-camp-style";

/** Rounded tensioned fabric outline, wholly inside the existing rectangular tent envelope. */
export const tentClothPoint = (width: number, depth: number, u: number, v: number): [number, number] => {
  let x = (u - .5) * width, z = (v - .5) * depth;
  const radius = Math.min(width, depth) * .1;
  const dx = Math.abs(x) - (width / 2 - radius), dz = Math.abs(z) - (depth / 2 - radius);
  if (dx > 0 && dz > 0) {
    const angle = Math.atan2(dz, dx);
    x = Math.sign(x) * (width / 2 - radius + Math.cos(angle) * radius);
    z = Math.sign(z) * (depth / 2 - radius + Math.sin(angle) * radius);
  }
  return [x, z];
};

/** Pitch follows supporting poles; shallow catenary sag and small wrinkles carry the cloth between them. */
export const tentRoofHeight = (
  shape: CampCanvasShape, u: number, v: number, eave: number, height: number
) => {
  const x = Math.abs(2 * u - 1), z = Math.abs(2 * v - 1);
  const back = Math.max(0, 1 - 2 * v);
  if (shape === "saddle") return height - .36 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) -
    .1 * Math.sin(u * Math.PI) - .08 * Math.sin(v * Math.PI);
  const slope = shape === "ridge" ? x : Math.max(x, Math.max(0, (back - .36) / .64));
  const peak = shape === "pagoda" ? Math.pow(1 - Math.max(x, z), 1.55) : 1 - slope;
  const sag = .095 * Math.sin(x * Math.PI) * Math.sin(v * Math.PI);
  const crease = .011 * Math.sin(u * Math.PI * 12) * Math.sin(x * Math.PI) * Math.sin(v * Math.PI);
  return eave + (height - eave) * peak - sag + crease;
};
