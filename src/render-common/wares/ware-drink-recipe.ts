import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";
import { srgbToLinear } from "../color";
import { addNationalDrinkWare } from "./ware-national-drinks";

/**
 * Nation drink chain wares (Roman grapes/wine, Viking honey/mead, Japanese rice/sake, Nubian
 * coconut/toddy). Each is one compact, recognisable cargo piece about the size of the beer cask,
 * standing on y ≈ -0.15 like the other wares; High adds the small craft details.
 */
/** Authored as display (sRGB) colours; vertex tints multiply in linear light. */
const GRAPE = srgbToLinear(0.36, 0.14, 0.42);
const OAK = srgbToLinear(0.95, 0.82, 0.7);
const DARK_OAK = srgbToLinear(0.72, 0.56, 0.44);
const RED_WAX = srgbToLinear(0.55, 0.06, 0.08);
const GLAZE = srgbToLinear(0.66, 0.4, 0.2);
const HONEY = srgbToLinear(0.95, 0.62, 0.14);
const HORN = srgbToLinear(0.86, 0.74, 0.52);
const SILVER = srgbToLinear(0.78, 0.8, 0.82);
const PAPER = srgbToLinear(0.95, 0.93, 0.86);
const VERMILION = srgbToLinear(0.78, 0.12, 0.08);
const INK = srgbToLinear(0.08, 0.07, 0.07);
const HUSK: Point3 = [2.1, 1.45, 0.95];
const COPRA = srgbToLinear(0.96, 0.94, 0.88);
const TERRACOTTA = srgbToLinear(0.76, 0.42, 0.26);
const GOURD = srgbToLinear(0.8, 0.66, 0.36);
const LEAF = srgbToLinear(0.45, 0.6, 0.24);

/** One bunch lying on its side in the bag, its stalk end towards `yaw`; High adds the stalk. */
const addBunch = (part: AddPart, x: number, z: number, yaw: number, detailed: boolean) => {
  // Parts turn about x, then y: the hanging bunch is laid down, then turned to its yaw.
  part("paint", [x, -0.06, z], [0.11, 0.17, 0.11], 3, "grape-bunch", [Math.PI / 2, yaw, 0], GRAPE);
  if (!detailed) return;
  part("wood", [x + DMath.sin(yaw) * 0.09, -0.06, z + DMath.cos(yaw) * 0.09], [0.008, 0.008, 0.04], 3, "box",
    [0, yaw, 0]);
};

/** Open linen bag filled with bunches: one canonical piece for carry, stock and cargo. */
const addGrapes = (part: AddPart, detailed: boolean) => {
  part("sacking", [0, -.025, 0], [.38, .25, .28], 3, "open-sack");
  const contents: AddPart = (surface, position, size, stage, shape, rotation, tint) =>
    part(surface, [position[0], position[1] + .2, position[2]], size, stage, shape, rotation, tint);
  addBunch(contents, -.085, -.015, .4, detailed);
  addBunch(contents, .075, .025, -.5 + Math.PI, detailed);
  addBunch(contents, .01, -.055, 1.3, detailed);
  if (detailed) for (const x of [-.15, .15])
    part("rope", [x, .09, 0], [.025, .012, .22], 3, "box");
};

const CASK_DIAMETER = 0.26;
/** Hoop diameter hugging the barrel profile (drink-vessel-geometry) at a height fraction 0..1. */
const hoopDiameter = (t: number) => (0.8 + 0.2 * DMath.sin(Math.PI * t)) * CASK_DIAMETER + 0.008;
/** Hoop fractions along the cask: the bilge hoops, then (High) the chime hoops. */
const HOOPS = { chime: [0.08, 0.92], bilge: [0.25, 0.75] } as const;

/** Iron hooped cask standing upright: barrel body and its hoops. */
const addCask = (part: AddPart, detailed: boolean, tint: Point3, height = 0.3) => {
  part("wood", [0, 0, 0], [CASK_DIAMETER, height, CASK_DIAMETER], 3, "barrel", undefined, tint);
  for (const t of [...HOOPS.bilge, ...(detailed ? HOOPS.chime : [])]) {
    const diameter = hoopDiameter(t);
    part("iron", [0, (t - 0.5) * height, 0], [diameter, 0.018, diameter], 3, "cylinder");
  }
};

/** Red wine is its oak cask alone, with a red-wax bung and no display cradle. */
const addWine = (part: AddPart, detailed: boolean) => {
  const axis: Point3 = [0, 0, Math.PI / 2], length = 0.32;
  part("wood", [0, -0.02, 0], [CASK_DIAMETER, length, CASK_DIAMETER], 3, "barrel", axis, OAK);
  for (const t of [...HOOPS.bilge, ...(detailed ? HOOPS.chime : [])]) {
    const diameter = hoopDiameter(t);
    part("iron", [(t - 0.5) * length, -0.02, 0], [diameter, 0.018, diameter], 3, "cylinder", axis);
  }
  part("paint", [0, 0.115, 0], [0.04, 0.014, 0.04], 3, "cylinder", undefined, RED_WAX);
  if (detailed) part("paint", [0.165, -0.02, 0], [0.006, 0.07, 0.07], 3, "cylinder", [0, 0, Math.PI / 2],
    srgbToLinear(0.45, 0.1, 0.14));
};

/** Glazed honey pot with a honey dipper, a honey run down its side and a cut comb beside it. */
const addHoney = (part: AddPart, detailed: boolean) => {
  part("paint", [-0.03, -0.035, 0], [0.24, 0.23, 0.24], 3, "honey-pot", undefined, GLAZE);
  part("amber", [-0.03, 0.07, 0], [0.15, 0.012, 0.15], 3, "cylinder", undefined, HONEY);
  part("wood", [0.0, 0.12, 0.02], [0.012, 0.16, 0.012], 3, "cylinder", [0.25, 0, -0.35]);
  part("wood", [0.03, 0.2, 0.04], [0.03, 0.03, 0.03], 3, "sphere");
  part("amber", [0.06, 0.02, 0.06], [0.03, 0.08, 0.02], 3, "sphere", undefined, HONEY);
  part("amber", [0.13, -0.07, -0.02], [0.03, 0.15, 0.12], 3, "box", [0, 0.3, -0.18], HONEY);
  if (detailed) part("paint", [0.135, 0.005, -0.02], [0.034, 0.012, 0.124], 3, "box", [0, 0.3, -0.18],
    srgbToLinear(0.98, 0.86, 0.55));
};

/** Mead keg of dark oak with a drinking horn tied on top (silver rim and tip). */
const addMead = (part: AddPart, detailed: boolean) => {
  addCask(part, detailed, DARK_OAK, 0.28);
  part("endgrain", [0, 0.135, 0], [0.2, 0.012, 0.2], 3, "cylinder");
  // The horn rests on the keg head: mouth (silver rim) to the east, its tip curling up to the west.
  const tilt = Math.PI / 2 - 0.15;
  part("paint", [0, 0.2, 0], [0.085, 0.27, 0.085], 3, "cone", [0, 0, tilt], HORN);
  part("paint", [0.134, 0.18, 0], [0.09, 0.014, 0.09], 3, "cylinder", [0, 0, tilt], SILVER);
  part("paint", [-0.151, 0.245, 0], [0.022, 0.06, 0.022], 3, "cone", [0, 0, 0.6], HORN);
  if (detailed) part("paint", [-0.168, 0.27, 0], [0.012, 0.016, 0.012], 3, "sphere", undefined, SILVER);
};

/** Open woven sack: large ivory grains stay readable in the shared inventory/cargo model. */
const addRice = (part: AddPart, detailed: boolean) => {
  const grain = srgbToLinear(0.96, 0.94, 0.84);
  part("sacking", [0, -.025, 0], [.34, .25, .27], 3, "open-sack");
  // A continuous bed prevents dark holes between grains; it remains below the rounded heap.
  part("paint", [0, .105, 0], [.275, .055, .21], 3, "sphere", undefined, grain);
  const rings = detailed ? [[12, .105, .078], [9, .068, .05], [5, .028, .023]] : [[8, .085, .06], [3, .025, .02]];
  rings.forEach(([count = 0, radiusX = 0, radiusZ = 0], layer) => {
    for (let index = 0; index < count; index++) {
      const angle = index * Math.PI * 2 / count + layer * .83;
      const yaw = angle + (index % 3 - 1) * .6;
      const shade = index % 4 === 0 ? srgbToLinear(.88, .85, .74) : grain;
      part("paint", [DMath.cos(angle) * radiusX, .124 + layer * .014, DMath.sin(angle) * radiusZ],
        [.045, .014, .017], 3, "sphere", [0, yaw, (index % 3 - 1) * .12], shade);
    }
  });
  if (!detailed) return;
  for (const x of [-.14, .14])
    part("rope", [x, .08, 0], [.018, .012, .18], 3, "box", [0, 0, x > 0 ? -.15 : .15]);
};

/** Komodaru: straw-wrapped sake cask, rope lattice, painted label and a lidded top. */
const addSake = (part: AddPart, detailed: boolean) => {
  part("straw", [0, 0, 0], [0.25, 0.27, 0.25], 3, "cylinder", undefined, srgbToLinear(0.97, 0.92, 0.76));
  part("endgrain", [0, 0.137, 0], [0.22, 0.012, 0.22], 3, "cylinder");
  part("paint", [0, 0, 0.127], [0.11, 0.13, 0.006], 3, "box", undefined, PAPER);
  part("paint", [0, 0.015, 0.131], [0.06, 0.06, 0.004], 3, "cylinder", [Math.PI / 2, 0, 0], VERMILION);
  if (!detailed) return;
  for (const y of [-0.1, 0.1]) part("rope", [0, y, 0], [0.258, 0.016, 0.258], 3, "ring");
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    part("rope", [DMath.sin(angle) * 0.128, 0, DMath.cos(angle) * 0.128], [0.012, 0.27, 0.012], 3, "box", [0, angle, 0]);
  }
  for (const x of [-0.025, 0.025]) part("paint", [x, -0.035, 0.131], [0.012, 0.05, 0.003], 3, "box", undefined, INK);
  part("rope", [0, 0.16, 0], [0.08, 0.05, 0.016], 3, "ring", [0, 0, 0]);
};

/** Two husked coconuts and (High) a split half showing the white flesh. */
const addCoconut = (part: AddPart, detailed: boolean) => {
  // Fibrous husks: the bark relief under a warm tint reads as coir.
  part("bark", [-0.07, -0.06, -0.03], [0.15, 0.17, 0.14], 3, "coconut", [0.3, 0, Math.PI / 2 - 0.2], HUSK);
  part("bark", [0.08, -0.06, -0.05], [0.14, 0.16, 0.13], 3, "coconut", [0, 0.8, Math.PI / 2 + 0.3], HUSK);
  if (!detailed) return;
  part("bark", [0.01, -0.105, 0.09], [0.14, 0.07, 0.14], 3, "bowl", undefined, HUSK);
  part("paint", [0.01, -0.073, 0.09], [0.115, 0.006, 0.115], 3, "cylinder", undefined, COPRA);
  for (const [x, z] of [[-0.022, 0], [0.012, -0.012], [0.012, 0.012]] as const)
    part("dark", [-0.155 + x * 0.3, -0.06 + z, -0.03 + x], [0.016, 0.016, 0.016], 3, "sphere");
};

/** Toddy: a terracotta jar stopped with a palm-leaf bung in a cord sling, a gourd cup tied on. */
const addToddy = (part: AddPart, detailed: boolean) => {
  part("paint", [0, -0.01, 0], [0.24, 0.3, 0.24], 3, "clay-jar", undefined, TERRACOTTA);
  part("leaf", [0, 0.155, 0], [0.07, 0.07, 0.07], 3, "cone", [Math.PI, 0, 0], LEAF);
  if (!detailed) return;
  part("rope", [0, 0.11, 0], [0.105, 0.016, 0.105], 3, "ring");
  part("paint", [0.15, -0.07, 0.03], [0.09, 0.13, 0.09], 3, "gourd", undefined, GOURD);
  part("rope", [0, -0.02, 0], [0.245, 0.014, 0.245], 3, "ring");
  part("paint", [-0.06, 0.02, 0.1], [0.06, 0.012, 0.012], 3, "box", [0, 0, 0.2], srgbToLinear(0.5, 0.25, 0.14));
};

const DRINK_WARE_RECIPES: Record<string, (part: AddPart, detailed: boolean) => void> = {
  coconut: addCoconut, grapes: addGrapes, honey: addHoney, mead: addMead, rice: addRice, sake: addSake,
  toddy: addToddy, wine: addWine
};

/** Adds a drink chain ware; false when the id is not one of them. */
export const addDrinkWare = (part: AddPart, id: string, detailed: boolean) => {
  if (addNationalDrinkWare(part, id, detailed)) return true;
  const recipe = DRINK_WARE_RECIPES[id];
  if (!recipe) return false;
  recipe(part, detailed);
  return true;
};
