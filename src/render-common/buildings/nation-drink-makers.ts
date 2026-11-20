import { DMath } from "../../shared/math/deterministic-math";
import { srgbToLinear } from "../color";
import type { BuildingPart, Point3 } from "./building-recipe";
import type { AddPart } from "./roman-resource-workshops";

/**
 * Work places of building slot 6 (the drink maker) per nation. The Roman press vat under the side
 * canopy (centre x 0.87, z -0.13) holds the raw ware input stock; each nation turns it into its own
 * vessel. The back yard behind the canopy (z -0.75..-1.2) takes the brewing hearth or stove. The
 * drink output stock in front of the canopy and every door/work anchor stay as authored.
 */
const VAT: Point3 = [0.87, 0, -0.13];
const HEARTH: Point3 = [0.87, 0, -0.98];
const HORN = srgbToLinear(0.86, 0.74, 0.52);
const FLAME = srgbToLinear(1, 0.62, 0.2);
const STRAW = srgbToLinear(0.95, 0.88, 0.68);
const PAPER = srgbToLinear(0.95, 0.93, 0.86);
const CEDAR = srgbToLinear(0.36, 0.5, 0.26);
const TERRACOTTA = srgbToLinear(0.74, 0.4, 0.24);
const GOURD = srgbToLinear(0.78, 0.62, 0.34);

/** The Roman press vat (floor disc and staved ring) that the nations replace or refit. */
export const isPressVatPart = (part: BuildingPart) => !part.stock &&
  Math.abs(part.position[0] - VAT[0]) < 0.01 && Math.abs(part.position[2] - VAT[2]) < 0.01 &&
  (part.shape === "cylinder" || part.shape === "ring");

/** A fire of crossed logs inside a ring of field stones. */
const addFire = (part: AddPart, centre: Point3, detailed: boolean) => {
  const stones = detailed ? 8 : 5;
  for (let stone = 0; stone < stones; stone += 1) {
    const angle = (stone / stones) * Math.PI * 2;
    part("stone", [centre[0] + DMath.cos(angle) * 0.17, 0.035, centre[2] + DMath.sin(angle) * 0.17],
      [0.09, 0.07, 0.08], 3, "rock");
  }
  for (const yaw of [0.4, -0.5]) part("bark", [centre[0], 0.04, centre[2]], [0.05, 0.26, 0.05], 3, "cylinder",
    [Math.PI / 2, yaw, 0]);
  part("amber", [centre[0], 0.1, centre[2]], [0.1, 0.14, 0.1], 3, "cone", undefined, FLAME);
};

/**
 * Viking meadery: the honey must ferments in a lidded oak tub with its paddle and drinking horns;
 * behind it the brewer boils honey water in an iron cauldron hung from a tripod over an open fire.
 */
export const addVikingMeadery = (part: AddPart, detailed: boolean) => {
  part("wood", [VAT[0], 0.05, VAT[2]], [0.7, 0.1, 0.7], 2, "cylinder");
  part("wood", [VAT[0], 0.27, VAT[2]], [0.7, 0.4, 0.7], 3, "ring");
  for (const y of detailed ? [0.15, 0.39] : []) part("iron", [VAT[0], y, VAT[2]], [0.72, 0.03, 0.72], 3, "ring");
  part("wood", [VAT[0] - 0.18, 0.485, VAT[2]], [0.3, 0.03, 0.66], 3, "box");
  part("wood", [VAT[0] + 0.1, 0.55, VAT[2] + 0.12], [0.03, 0.5, 0.03], 3, "cylinder", [0.5, 0, -0.3]);
  addFire(part, HEARTH, detailed);
  for (const angle of [0, 2.1, 4.2])
    part("bark", [HEARTH[0] + DMath.cos(angle) * 0.17, 0.36, HEARTH[2] + DMath.sin(angle) * 0.17], [0.035, 0.76, 0.035],
      2, "cylinder", [DMath.sin(angle) * 0.22, 0, -DMath.cos(angle) * 0.22]);
  part("iron", [HEARTH[0], 0.53, HEARTH[2]], [0.012, 0.2, 0.012], 3, "cylinder");
  part("iron", [HEARTH[0], 0.33, HEARTH[2]], [0.3, 0.2, 0.3], 3, "bowl");
  if (!detailed) return;
  // Two drinking horns rest on the tub lid.
  for (const dz of [-0.14, 0.12])
    part("paint", [VAT[0] - 0.18, 0.53, VAT[2] + dz], [0.06, 0.24, 0.06], 3, "cone", [0, 0.2, Math.PI / 2 - 0.12], HORN);
};

/**
 * Japanese sake brewery: the moromi tub bound with bamboo hoops, a kamado stove with its rice
 * steamer (koshiki) behind it, a stack of straw komodaru casks and the green cedar ball (sugidama)
 * that announces new sake, hung from the canopy beam.
 */
export const addJapaneseDistillery = (part: AddPart, detailed: boolean) => {
  part("wood", [VAT[0], 0.05, VAT[2]], [0.7, 0.1, 0.7], 2, "cylinder");
  part("wood", [VAT[0], 0.27, VAT[2]], [0.7, 0.4, 0.7], 3, "ring");
  for (const y of detailed ? [0.12, 0.27, 0.42] : []) part("paint", [VAT[0], y, VAT[2]], [0.72, 0.035, 0.72], 3, "ring", undefined,
    srgbToLinear(0.56, 0.66, 0.3));
  part("plaster", [HEARTH[0] + 0.16, 0.17, HEARTH[2]], [0.5, 0.34, 0.38], 2, "box");
  part("dark", [HEARTH[0] + 0.16, 0.1, HEARTH[2] + 0.191], [0.16, 0.12, 0.01], 3, "window-shadow");
  part("wood", [HEARTH[0] + 0.16, 0.45, HEARTH[2]], [0.3, 0.22, 0.3], 3, "cylinder");
  part("wood", [HEARTH[0] + 0.16, 0.57, HEARTH[2]], [0.32, 0.03, 0.32], 3, "cylinder");
  // Komodaru lie two below and one on top, their labelled heads facing the yard.
  const casks: Array<[number, number]> = detailed ? [[-0.1, 0.1], [0.1, 0.1], [0, 0.28]] : [[0, 0.1]];
  for (const [dz, y] of casks) {
    part("straw", [0.5, y, HEARTH[2] + dz], [0.2, 0.2, 0.2], 3, "cylinder", [0, 0, Math.PI / 2], STRAW);
    part("paint", [0.603, y, HEARTH[2] + dz], [0.006, 0.1, 0.08], 3, "box", undefined, PAPER);
  }
  // Sugidama: hung by a cord from the canopy's front beam, clear of the work point and stock.
  const hang: Point3 = [1.18, 1.2, 0.35];
  part("rope", [hang[0], hang[1] - 0.06, hang[2]], [0.01, 0.12, 0.01], 3, "cylinder");
  part("leaf", [hang[0], hang[1] - 0.24, hang[2]], [0.24, 0.24, 0.24], 3, "sphere", undefined, CEDAR);
};

/**
 * Nubian toddy maker: the sap ferments in a wide clay basin in place of the vat; behind it a
 * mud-brick bench holds the sealed toddy jars, with gourd cups at its end.
 */
export const addNubianToddyMaker = (part: AddPart, detailed: boolean) => {
  part("paint", [VAT[0], 0.12, VAT[2]], [0.72, 0.26, 0.72], 3, "bowl", undefined, TERRACOTTA);
  part("plaster", [HEARTH[0], 0.12, HEARTH[2]], [0.78, 0.24, 0.32], 2, "box");
  const jars = detailed ? [-0.24, -0.03, 0.18] : [-0.18, 0.12];
  for (const dx of jars) {
    part("paint", [HEARTH[0] + dx, 0.355, HEARTH[2]], [0.15, 0.23, 0.15], 3, "clay-jar", undefined, TERRACOTTA);
    part("leaf", [HEARTH[0] + dx, 0.485, HEARTH[2]], [0.05, 0.05, 0.05], 3, "cone", [Math.PI, 0, 0]);
  }
  if (!detailed) return;
  for (const [dx, dz] of [[0.42, 0.06], [0.5, -0.05]] as const)
    part("paint", [HEARTH[0] + dx, 0.07, HEARTH[2] + dz], [0.1, 0.14, 0.1], 3, "gourd", undefined, GOURD);
};
