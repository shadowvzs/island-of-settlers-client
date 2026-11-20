import { DMath } from "../../shared/math/deterministic-math";
import { srgbToLinear } from "../color";
import { withBuildingStock } from "./building-stock-parts";
import type { AddPart } from "./roman-resource-workshops";

export type RomanStockBagContents = "flour" | "coal" | "ore" | "gold";

/** Authored as display sRGB: the paint surface multiplies vertex tints in linear light. */
const COAL_CONTENTS_TINT = srgbToLinear(0.13, 0.135, 0.14);

const getStockBagContentsTint = (contents: RomanStockBagContents): [number, number, number] => {
  if (contents === "coal") return COAL_CONTENTS_TINT;
  if (contents === "gold") return [0.59, 0.43, 0.13];
  return [0.43, 0.25, 0.16];
};

export const addRomanStockBag = (
  part: AddPart,
  x: number,
  z: number,
  detailed: boolean,
  contents: RomanStockBagContents = "flour",
  scale = 1
) => {
  if (contents !== "flour") {
    addRomanOpenMineralBag(part, x, z, detailed, contents, scale);
    return;
  }
  const linen: [number, number, number] = [0.43, 0.34, 0.22];
  part("paint", [x, 0.375, z], [0.29, 0.39, 0.26], 3, "sack", undefined, linen);
  part("rope", [x, 0.548, z], [0.078, 0.022, 0.075], 3, "cylinder");
  part("paint", [x, 0.572, z], [0.075, 0.04, 0.073], 3, "sphere", undefined, linen);
  // Small chalk flour mark directly on the cloth, with stitching along the seam.
  part(
    "paint",
    [x, 0.39, z + 0.122],
    [0.064, 0.08, 0.004],
    3,
    "sphere",
    undefined,
    [0.74, 0.7, 0.6]
  );
  if (!detailed) return;
  for (let i = 0; i < 5; i++)
    part("rope", [x - 0.055, 0.27 + i * 0.042, z + 0.119], [0.013, 0.006, 0.006], 3);
};

export const addRomanWheatBales = (
  part: AddPart,
  width: number,
  depth: number,
  detailed: boolean,
  centerX = 0,
  density = 1
) => {
  const x = centerX - width / 2 - 0.23,
    z = depth / 2 + 0.05;
  const compactMinimal = !detailed && density < 1;
  // Packed individual stems expose irregular cut ends instead of a solid bale cylinder.
  const minimalStalks = compactMinimal ? 3 : 6;
  const stalks = detailed ? Math.max(12, Math.round(100 * density)) : minimalStalks;
  for (let i = 0; i < stalks; i++) {
    const angle = i * 2.3999632297;
    const radius = Math.sqrt((i + 0.5) / stalks);
    const sx = x + DMath.cos(angle) * radius * (detailed ? 0.09 : 0.08);
    const sy =
      detailed && i === 0 ? 0.187 : 0.26 + DMath.sin(angle) * radius * (detailed ? 0.073 : 0.06);
    const length = 0.44 + ((i * 7) % 11) * 0.012;
    const minimalDiameter = compactMinimal ? 0.095 : 0.07;
    const diameter = detailed ? 0.014 / Math.sqrt(density) : minimalDiameter;
    part(
      "straw",
      [sx, sy, z + DMath.sin(i * 3.1) * 0.027],
      [diameter, length, diameter],
      3,
      "wheat-stalk",
      [Math.PI / 2, 0, 0],
      [0.85 + (i % 5) * 0.035, 0.87 + (i % 4) * 0.035, 0.87 + (i % 3) * 0.04]
    );
  }
  for (const end of [-1, 1]) {
    const minimalSegments = compactMinimal ? 3 : 6;
    const segments = detailed ? 12 : minimalSegments;
    for (let i = 0; i < segments; i++) {
      const angle = (i * Math.PI * 2) / segments;
      const next = ((i + 1) * Math.PI * 2) / segments;
      const startX = DMath.sin(angle) * (detailed ? 0.1 : 0.135);
      const startY = DMath.cos(angle) * (detailed ? 0.08 : 0.093);
      const endX = DMath.sin(next) * (detailed ? 0.1 : 0.135);
      const endY = DMath.cos(next) * (detailed ? 0.08 : 0.093);
      const dx = endX - startX,
        dy = endY - startY;
      part(
        "rope",
        [x + (startX + endX) / 2, (detailed ? 0.26 : 0.273) + (startY + endY) / 2, z + end * 0.1],
        [0.009, DMath.hypot(dx, dy) + 0.004, 0.009],
        3,
        compactMinimal ? "box" : "cord",
        [0, 0, DMath.atan2(-dx, dy)]
      );
    }
  }
  const minimalEars = compactMinimal ? 1 : 3;
  const count = detailed ? Math.max(6, Math.round(24 * density)) : minimalEars;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.3999632297;
    const radius = Math.sqrt((i + 0.5) / count);
    const sx = x + DMath.sin(angle) * radius * 0.087;
    const sy = 0.26 + DMath.cos(angle) * radius * 0.071;
    const length = 0.49 + (i % 5) * 0.024;
    const lean = DMath.sin(angle) * 0.085;
    const color: [number, number, number] = [0.5 + (i % 3) * 0.035, 0.33 + (i % 4) * 0.025, 0.095];
    part("paint", [sx, sy, z], [0.006, length, 0.006], 3, "cord", [Math.PI / 2, lean, 0], color);
    // Broken straw among intact ears keeps the cut ends irregular.
    if (!compactMinimal && i % 4 === 0) continue;
    const headLength = 0.08 + (i % 3) * 0.014;
    part(
      "paint",
      [sx + (DMath.sin(lean) * length) / 2, sy, z + length / 2 + headLength * 0.27],
      [0.026, headLength, 0.02],
      3,
      "wheat-ear",
      [Math.PI / 2, lean, 0],
      color
    );
  }
};

/** Two supported shelves, three separate carcass bays per shelf. */
const ROMAN_BUTCHER_INPUT_SLOTS = [
  [-0.38, 0, 0],
  [0, 0, 0],
  [0.38, 0, 0],
  [-0.38, 0.41, 0],
  [0, 0.41, 0],
  [0.38, 0.41, 0]
] as const;

export const addRomanButcherInputs = (
  part: AddPart,
  width: number,
  depth: number,
  detailed: boolean
) => {
  const authoredX = width / 2 - 0.41,
    authoredZ = depth / 2 + 0.405;
  const destinationZ = -depth / 2 - 0.4;
  const original = part;
  part = (surface, position, size, stage, shape, rotation, tint, stock) =>
    original(
      surface,
      [position[0] - authoredX, position[1], destinationZ + position[2] - authoredZ],
      size,
      stage,
      shape,
      rotation,
      tint, stock
    );
  const x = authoredX,
    z = authoredZ;
  // Four feet reach the ground; crossbeams carry both decks and the light shade roof.
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part("wood", [x + side * 0.565, 0.6, z + end * 0.285], [0.045, 0.84, 0.045], 2);
  for (const y of [0.25, 0.66]) {
    part("wood", [x, y, z], [1.2, 0.045, 0.66], 3);
    if (detailed)
      for (const end of [-1, 1])
        part("wood", [x, y - 0.05, z + end * 0.28], [1.17, 0.055, 0.055], 2);
  }
  part("wood", [x, 1.045, z], [1.31, 0.05, 0.74], 3);
  for (const [slot, [offsetX, offsetY]] of ROMAN_BUTCHER_INPUT_SLOTS.entries())
    addPigCarcass(withBuildingStock(part, "pig", slot, "input"), x + offsetX, z - 0.08, offsetY, detailed);
};

const addPigCarcass = (part: AddPart, x: number, z: number, tier: number, detailed: boolean) => {
  const skin: [number, number, number] = [0.47, 0.29, 0.23];
  const pig: AddPart = (surface, position, size, stage, shape, rotation, tint) =>
    part(
      surface,
      [position[0], position[1] + tier, position[2]],
      size,
      stage,
      shape,
      rotation,
      tint
    );
  pig("paint", [x, 0.37, z], [0.29, 0.22, 0.43], 3, "sphere", undefined, skin);
  pig(
    "paint",
    [x, 0.34, z + 0.24],
    [0.18, 0.15, 0.17],
    3,
    detailed ? "sphere" : "box",
    undefined,
    skin
  );
  pig(
    "paint",
    [x, 0.33, z + 0.32],
    [0.1, 0.055, 0.1],
    3,
    detailed ? "cylinder" : "box",
    [Math.PI / 2, 0, 0],
    skin
  );
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      if (detailed)
        pig(
          "paint",
          [x + side * 0.13, 0.3, z + end * 0.12],
          [0.07, 0.065, 0.065],
          3,
          "sphere",
          undefined,
          skin
        );
      if (detailed) pig("dark", [x + side * 0.17, 0.288, z + end * 0.12], [0.04, 0.025, 0.035], 3);
      else pig("dark", [x + side * 0.14, 0.3, z + end * 0.12], [0.075, 0.055, 0.05], 3);
    }
    if (!detailed && side === -1) continue;
    pig(
      "paint",
      [x + side * 0.068, 0.385, z + 0.2],
      [0.035, 0.06, 0.045],
      3,
      detailed ? "sphere" : "box",
      [0, 0, side * 0.5],
      skin
    );
    if (!detailed) continue;
    pig("dark", [x + side * 0.084, 0.346, z + 0.25], [0.007, 0.004, 0.035], 3);
    pig("dark", [x + side * 0.025, 0.338, z + 0.35], [0.013, 0.014, 0.006], 3, "sphere");
  }
};

const addRomanOpenMineralBag = (
  part: AddPart,
  x: number,
  z: number,
  detailed: boolean,
  contents: "coal" | "ore" | "gold",
  scale: number
) => {
  const bag: AddPart = (surface, position, size, stage, shape, rotation, tint) =>
    part(
      surface,
      [x + position[0] * scale, 0.18 + (position[1] - 0.18) * scale, z + position[2] * scale],
      size.map((value) => value * scale) as [number, number, number],
      stage,
      shape,
      rotation,
      tint
    );
  bag("sacking", [0, 0.35, 0], [0.29, 0.34, 0.26], 3, "open-sack");
  const tint = getStockBagContentsTint(contents);
  bag("paint", [0, 0.455, 0], [0.178, 0.006, 0.156], 3, "cylinder", undefined, tint);
  for (let i = 0; i < (detailed ? 4 : 2); i++)
    bag(
      "paint",
      [
        (i % 2) * 0.065 - 0.032,
        0.478 + Math.floor(i / 2) * 0.012,
        Math.floor(i / 2) * 0.05 - 0.025
      ],
      [0.053, 0.039, 0.045],
      3,
      "rock",
      undefined,
      tint
    );
};
