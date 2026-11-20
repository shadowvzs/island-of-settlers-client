import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import type { AddPart } from "./roman-resource-workshops";
import { addAmphora, isTavernYardDecor, TAVERN_HALL, TAVERN_YARD } from "./roman-tavern";

type BuildNation = Exclude<WorkerNation, "roman">;
/** Finished recipes stand on the ground at y = 0 (the authoring base of 0.18 is already removed). */
const FRONT = TAVERN_HALL.depth / 2;
const BALCONY_UNDERSIDE = 0.965;
const RED: Point3 = [0.72, 0.08, 0.05];
const INDIGO: Point3 = [0.1, 0.13, 0.32];
const CLAY: Point3 = [0.66, 0.36, 0.2];
const MEAD: Point3 = [0.55, 0.36, 0.12];
/**
 * Lantern cords either side of the entrance lane: the west one under the balcony floor's end
 * (it reaches x -0.89), the east one at a joist end (roman-tavern addUpperStorey).
 */
const IZAKAYA_LANTERN_X = [-0.88, -0.1] as const;

export const adder = (parts: BuildingPart[]): AddPart => (surface, position, size, stage = 3, shape = "box", rotation, tint) => {
  parts.push({ position, rotation, shape, size, stage, surface, tint });
};

/** A low log, laid along X, used as a seat. */
const logSeat = (part: AddPart, x: number, z: number, length: number) =>
  part("bark", [x, 0.08, z], [0.13, length, 0.13], 3, "cylinder", [0, 0, Math.PI / 2]);

/** Viking mead hall: trestle table on log seats under a plank lean-to, and mead casks. */
const addVikingYard = (part: AddPart, detailed: boolean) => {
  const x = 1.02, z = -0.3;
  part("wood", [x, 0.4, z], [0.56, 0.05, 0.26], 3);
  for (const end of [-1, 1]) {
    part("wood", [x + end * 0.22, 0.2, z], [0.05, 0.36, 0.2], 3);
    part("wood", [x + end * 0.22, 0.03, z], [0.07, 0.06, 0.26], 3);
  }
  for (const side of [-1, 1]) logSeat(part, x, z + side * 0.25, 0.56);
  // Turned wooden cups on the table.
  for (const offset of detailed ? [-0.15, 0.02, 0.17] : [0])
    part("wood", [x + offset, 0.455, z + 0.03], [0.045, 0.06, 0.045], 3, "cylinder");
  // A plank lean-to on two posts shelters the table from the hall wall outwards.
  const roofSlope = 0.255, roofLeft = 0.33, roofRight = 1.4;
  part("wood", [(roofLeft + roofRight) / 2, 0.88, -0.27], [roofRight - roofLeft, 0.04, 0.72], 4, "box",
    [0, 0, -roofSlope]);
  for (const postZ of [-0.58, 0.04]) part("bark", [1.32, 0.38, postZ], [0.06, 0.76, 0.06], 2, "cylinder");
  if (detailed) part("wood", [1.32, 0.74, -0.27], [0.06, 0.06, 0.72], 2);
  // Mead casks lie in a cradle against the hall.
  part("wood", [0.5, 0.05, 0.02], [0.2, 0.1, 0.34], 3);
  for (const offset of [-0.08, 0.08]) {
    part("wood", [0.5, 0.19, 0.02 + offset], [0.17, 0.15, 0.17], 3, "cylinder", [0, 0, Math.PI / 2], MEAD);
    if (detailed) part("iron", [0.5, 0.19, 0.02 + offset], [0.18, 0.02, 0.18], 3, "ring", [0, 0, Math.PI / 2]);
  }
};

/** Nubian courtyard inn: mud-brick courtyard walls, a palm-frond shade, zir water jars and a mat. */
const addNubianYard = (part: AddPart, detailed: boolean) => {
  const { maxX, minX, minZ } = TAVERN_YARD;
  const rear = minZ + 0.04, east = maxX + 0.08, wallHeight = 0.42;
  part("plaster", [(minX + east) / 2, wallHeight / 2, rear], [east - minX, wallHeight, 0.09], 2);
  part("plaster", [east, wallHeight / 2, (rear + 0.08) / 2], [0.09, wallHeight, 0.08 - rear], 2);
  if (detailed) for (let i = 0; i < 6; i++)
    part("plaster", [minX + 0.08 + i * 0.18, wallHeight + 0.035, rear], [0.07, 0.07, 0.09], 3);
  // Palm-trunk posts carry a frond mat over the seating.
  const shade = { maxX: 1.25, maxZ: 0.08, minX: 0.62, minZ: -0.46 };
  for (const x of [shade.minX, shade.maxX]) for (const z of [shade.minZ, shade.maxZ])
    part("bark", [x, 0.5, z], [0.06, 1.0, 0.06], 2, "cylinder");
  for (const x of [shade.minX, shade.maxX])
    part("wood", [x, 1.02, (shade.minZ + shade.maxZ) / 2], [0.05, 0.05, shade.maxZ - shade.minZ + 0.1], 2);
  part("straw", [(shade.minX + shade.maxX) / 2, 1.07, (shade.minZ + shade.maxZ) / 2],
    [shade.maxX - shade.minX + 0.16, 0.04, shade.maxZ - shade.minZ + 0.16], 3);
  // Woven mat, a low round table with a brass tray and cushions.
  const centerX = (shade.minX + shade.maxX) / 2, centerZ = (shade.minZ + shade.maxZ) / 2;
  part("straw", [centerX, 0.008, centerZ], [0.52, 0.016, 0.4], 3);
  part("wood", [centerX, 0.1, centerZ], [0.26, 0.18, 0.26], 3, "cylinder");
  part("gold", [centerX, 0.2, centerZ], [0.22, 0.015, 0.22], 3, "cylinder");
  if (detailed) for (const side of [-1, 1])
    part("paint", [centerX + side * 0.22, 0.04, centerZ], [0.14, 0.07, 0.2], 3, "sphere", undefined, INDIGO);
  // Zir jars keep the water cool in the courtyard's rear corner.
  for (const x of detailed ? [0.48, 0.62] : [0.5]) {
    part("wood", [x, 0.08, -0.47], [0.14, 0.16, 0.14], 3, "ring");
    part("paint", [x, 0.27, -0.47], [0.17, 0.26, 0.17], 3, "sphere", undefined, CLAY);
  }
};

/** Japanese izakaya: a red-felt bench under a paper parasol and stacked straw-wrapped sake casks. */
const addJapaneseYard = (part: AddPart, detailed: boolean) => {
  const x = 0.95, z = -0.3;
  part("wood", [x, 0.2, z], [0.62, 0.04, 0.24], 3);
  part("cloth", [x, 0.225, z], [0.6, 0.012, 0.22], 3, "box", undefined, RED);
  for (const end of [-1, 1]) part("wood", [x + end * 0.26, 0.09, z], [0.04, 0.18, 0.2], 3);
  // Nodate-gasa: a tall parasol on a bamboo pole planted beside the bench.
  part("wood", [x + 0.02, 0.55, z - 0.16], [0.03, 1.1, 0.03], 2, "cylinder");
  part("cloth", [x + 0.02, 1.12, z - 0.16], [0.7, 0.16, 0.7], 3, "cone", undefined, RED);
  if (detailed) part("dark", [x + 0.02, 1.06, z - 0.16], [0.6, 0.012, 0.6], 3, "ring");
  // Komodaru: straw-wrapped sake casks stacked two and one, each with a painted label.
  const caskX = 0.55;
  for (const [dz, y] of [[0, 0.11]] as const) {
    part("straw", [caskX, y, dz - 0.38], [0.19, 0.2, 0.19], 3, "cylinder", [0, 0, Math.PI / 2]);
    if (!detailed) continue;
    part("paint", [caskX + 0.1, y, dz - 0.38], [0.012, 0.1, 0.08], 3, "box", undefined, [0.92, 0.9, 0.84]);
    for (const offset of [-0.06, 0.06]) part("rope", [caskX + offset, y, dz - 0.38], [0.2, 0.012, 0.2], 3, "ring",
      [0, 0, Math.PI / 2]);
  }
};

/** Japanese street front: red paper lanterns hang under the balcony and a noren over the counter. */
const addIzakayaFront = (part: AddPart, detailed: boolean) => {
  // Both lanterns hang from the balcony outside the entrance lane, one on each side of it.
  for (const x of IZAKAYA_LANTERN_X.slice(0, 1)) {
    part("rope", [x, BALCONY_UNDERSIDE - 0.05, FRONT + 0.2], [0.008, 0.1, 0.008], 3, "cylinder");
    part("paint", [x, BALCONY_UNDERSIDE - 0.2, FRONT + 0.2], [0.13, 0.2, 0.13], 3, "sphere", undefined, RED);
    for (const dy of [-0.1, 0.1]) part("dark", [x, BALCONY_UNDERSIDE - 0.2 + dy, FRONT + 0.2], [0.07, 0.02, 0.07], 3,
      "cylinder");
  }
  const strips = detailed ? 2 : 1;
  for (let i = 0; i < strips; i++)
    part("cloth", [0.05 + (i - (strips - 1) / 2) * 0.17, 0.7, FRONT + 0.17], [strips > 1 ? 0.16 : 0.5, 0.16, 0.012], 3,
      "box", undefined, INDIGO);
};

/** Viking street front: a mead horn hangs from the balcony over the counter. */
const addMeadHallFront = (part: AddPart) => {
  part("rope", [-0.06, BALCONY_UNDERSIDE - 0.05, FRONT + 0.2], [0.008, 0.1, 0.008], 3, "cylinder");
  part("paint", [-0.06, BALCONY_UNDERSIDE - 0.17, FRONT + 0.2], [0.07, 0.2, 0.07], 3, "cone", [0, 0, Math.PI - 0.5],
    [0.86, 0.79, 0.62]);
};

/** Nubian street front: a clay water jar beside the door for travellers. */
const addCourtyardInnFront = (part: AddPart, detailed: boolean) => {
  addAmphora(part, -0.88, 0, FRONT + 0.14, detailed, 0.8);
};

/**
 * Each nation furnishes the Tavern's courtyard and street front in its own manner; the hall's
 * architecture comes from the nation kit. Stock places, door, work and approach anchors are kept.
 */
export const applyNationTavernDesign = (recipe: BuildingRecipe, nation: BuildNation, detailed: boolean) => {
  const parts = recipe.parts.filter(part => !isTavernYardDecor(part));
  const part = adder(parts);
  if (nation === "viking") { addVikingYard(part, detailed); addMeadHallFront(part); }
  if (nation === "nubian") { addNubianYard(part, detailed); addCourtyardInnFront(part, detailed); }
  if (nation === "japanese") { addJapaneseYard(part, detailed); addIzakayaFront(part, detailed); }
  return { ...recipe, parts };
};
