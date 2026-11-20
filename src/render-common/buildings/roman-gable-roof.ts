import { DMath } from "../../shared/math/deterministic-math";
import type { AddPart } from "./roman-resource-workshops";

/** Terracotta gable pitch shared by Roman houses and their attached lean-tos. */
export const ROMAN_GABLE_PITCH = 0.54;

/** Two tiled slopes, a ridge roll and stone gable ends over a plan rectangle. */
export const addRomanGableRoof = (part: AddPart, detailed: boolean,
  x: number, y: number, z: number, width: number, depth: number) => {
  const slope = ROMAN_GABLE_PITCH;
  for (const side of [-1, 1]) {
    part("roof", [x + side * width / 4, y + DMath.tan(slope) * width / 4, z],
      [width / 2 / DMath.cos(slope), .065, depth], 4, "box", [0, 0, -side * slope]);
  }
  part("roof", [x, y + DMath.tan(slope) * width / 2, z], [.12, depth + .04, .12], 4, "cylinder",
    [Math.PI / 2, 0, 0]);
  const rise = DMath.tan(slope) * width / 2;
  for (const end of [-1, 1]) part("stone", [x, y + rise / 2, z + end * (depth / 2 - .07)],
    [width - .1, rise, .08], 3, "gable");
  if (!detailed) return;
  for (const end of [-1, 1]) part("stone", [x, y + .04, z + end * depth / 2], [width, .045, .055], 4);
};

export const createRomanGableRoof = (part: AddPart, detailed: boolean) =>
  (x: number, y: number, z: number, width: number, depth: number) =>
    addRomanGableRoof(part, detailed, x, y, z, width, depth);
