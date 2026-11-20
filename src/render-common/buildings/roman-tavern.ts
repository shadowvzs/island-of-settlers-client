import { authorBuildingArchitecture } from "./building-architecture";
import type { BuildingPart, Point3 } from "./building-recipe";
import {
  romanBench, romanChimney, type RomanDesignContext,
romanRoom, romanWallOpening} from "./roman-design-kit";
import type { AddPart } from "./roman-resource-workshops";
import { addPositionedRomanWareStock } from "./roman-stock-layout";

/** Plan of the Roman taberna: a two-storey inn with a street counter and a vine pergola. */
export const TAVERN_HALL = { centerX: -0.3, depth: 1.2, entryX: -0.5, height: 1.52, width: 1.3 } as const;
/** The pergola courtyard east of the hall; nation designs replace everything in it. */
export const TAVERN_YARD = { maxX: 1.32, maxZ: 0.62, minX: 0.38, minZ: -0.62 } as const;
const FRONT = TAVERN_HALL.depth / 2;
const HALL_RIGHT = TAVERN_HALL.centerX + TAVERN_HALL.width / 2;
const UPPER_FLOOR = 1.08;
const EQUIPMENT_BENCH_Z = TAVERN_YARD.maxZ - 0.3;
/** Every recruiting ingredient a carrier can bring has one visible place on the yard bench. */
const TAVERN_INPUT_WARES = ["sword", "shield", "axe", "bow", "armor", "beer"] as const;
const TERRACOTTA: Point3 = [0.62, 0.3, 0.17];
const WINE_RED: Point3 = [0.42, 0.08, 0.1];

/** An amphora: belly, shoulder, neck and two handles. */
export const addAmphora = (part: AddPart, x: number, y: number, z: number, detailed: boolean, scale = 1) => {
  part("paint", [x, y + 0.11 * scale, z], [0.13 * scale, 0.2 * scale, 0.13 * scale], 3, "sphere", undefined, TERRACOTTA);
  part("paint", [x, y + 0.24 * scale, z], [0.05 * scale, 0.08 * scale, 0.05 * scale], 3, "cylinder", undefined, TERRACOTTA);
  if (!detailed) return;
  part("paint", [x, y + 0.29 * scale, z], [0.065 * scale, 0.02 * scale, 0.065 * scale], 3, "cylinder", undefined, TERRACOTTA);
  for (const side of [-1, 1])
    part("paint", [x + side * 0.04 * scale, y + 0.24 * scale, z], [0.012 * scale, 0.07 * scale, 0.03 * scale], 3,
      "ring", [0, Math.PI / 2, 0], TERRACOTTA);
};

/** Upper storey: a timber balcony on joists that run back into the wall, with shuttered windows. */
const addUpperStorey = ({ detailed, part }: RomanDesignContext) => {
  const { centerX, width } = TAVERN_HALL;
  part("stone", [centerX, UPPER_FLOOR, 0], [width + 0.05, 0.06, TAVERN_HALL.depth + 0.05], 2);
  for (const x of [-0.82, -0.5, -0.1, 0.22])
    part("wood", [x, UPPER_FLOOR + 0.03, FRONT + 0.1], [0.06, 0.06, 0.32], 2);
  part("wood", [centerX, UPPER_FLOOR + 0.085, FRONT + 0.15], [width - 0.12, 0.04, 0.27], 2);
  for (const x of [-0.84, -0.3, 0.24]) part("wood", [x, UPPER_FLOOR + 0.25, FRONT + 0.265], [0.035, 0.3, 0.035], 3);
  part("wood", [centerX, UPPER_FLOOR + 0.4, FRONT + 0.265], [width - 0.1, 0.035, 0.04], 3);
  if (detailed)
    for (let i = 0; i < 14; i++)
      part("wood", [-0.82 + i * 0.081, UPPER_FLOOR + 0.24, FRONT + 0.265], [0.016, 0.28, 0.016], 3);
  // Upper windows and the balcony door: dark openings set into the front wall.
  for (const x of [-0.7, 0.1]) {
    part("dark", [x, UPPER_FLOOR + 0.3, FRONT + 0.058], [0.2, 0.26, 0.012], 3);
    if (detailed) for (const side of [-1, 1])
      part("wood", [x + side * 0.135, UPPER_FLOOR + 0.3, FRONT + 0.07], [0.07, 0.28, 0.015], 3);
  }
  part("dark", [-0.3, UPPER_FLOOR + 0.25, FRONT + 0.058], [0.18, 0.36, 0.012], 3);
  for (const z of [-0.25, 0.25]) part("dark", [TAVERN_HALL.centerX - width / 2 - 0.004, UPPER_FLOOR + 0.3, z],
    [0.012, 0.22, 0.16], 3);
};

/** Thermopolium counter: a serving hatch in the street wall over a marble top with sunken jars. */
const addStreetCounter = (context: RomanDesignContext) => {
  const { detailed, part, parts } = context;
  const wall = parts.find(piece => piece.surface === "stone" && Math.abs(piece.position[2] - FRONT) < 0.01 &&
    piece.position[0] > TAVERN_HALL.entryX && piece.size[1] > 1);
  if (wall) romanWallOpening(context, wall, 0.05, 0.6, 0.42, 0.34);
  part("cut-stone", [0.05, 0.6, FRONT + 0.06], [0.52, 0.045, 0.24], 3);
  for (const x of [-0.08, 0.18]) {
    part("paint", [x, 0.632, FRONT + 0.07], [0.1, 0.02, 0.1], 3, "cylinder", undefined, TERRACOTTA);
    part("dark", [x, 0.643, FRONT + 0.07], [0.07, 0.006, 0.07], 3, "cylinder");
  }
  part("wood", [0.05, 0.98, FRONT + 0.11], [0.56, 0.035, 0.14], 3);
  if (!detailed) return;
  part("paint", [0.05, 0.645, FRONT + 0.15], [0.045, 0.05, 0.045], 3, "cylinder", undefined, WINE_RED);
  for (const x of [-0.12, 0.22])
    part("wood", [x, 0.79, FRONT + 0.165], [0.025, 0.36, 0.025], 3);
};

/** Inn sign with a painted wine jug, fixed to the west wall where the street approaches. */
const addInnSign = ({ detailed, part }: RomanDesignContext) => {
  const x = TAVERN_HALL.centerX - TAVERN_HALL.width / 2 - 0.0125, z = 0.22;
  part("wood", [x, 0.82, z], [0.025, 0.2, 0.28], 3, "bevel-box");
  part("paint", [x - 0.014, 0.81, z], [0.008, 0.1, 0.085], 3, "sphere", undefined, WINE_RED);
  if (detailed) part("gold", [x - 0.016, 0.875, z], [0.008, 0.045, 0.028], 3);
};

/** Pergola: four columns, timber beams, cross slats and a vine canopy over the drinking yard. */
const addPergola = ({ detailed, part }: RomanDesignContext) => {
  const { maxX, maxZ, minX, minZ } = TAVERN_YARD;
  const left = minX + 0.12, right = maxX - 0.08, rear = minZ + 0.08, front = maxZ - 0.1;
  for (const x of [left, right]) for (const z of [rear, front]) {
    part("stone", [x, 0.225, z], [0.14, 0.09, 0.14], 2);
    part("stone", [x, 0.72, z], [0.085, 0.92, 0.085], 2, "cylinder");
  }
  for (const x of [left, right]) part("wood", [x, 1.21, (rear + front) / 2], [0.07, 0.07, front - rear + 0.16], 2);
  const slats = detailed ? 7 : 3;
  for (let i = 0; i < slats; i++) {
    const z = rear + (front - rear) * (i / (slats - 1));
    part("wood", [(left + right) / 2, 1.265, z], [right - left + 0.18, 0.04, 0.045], 3);
  }
  // Vine leaves sit on the slats (fewer, larger clusters on Minimal); grapes hang between them.
  const clusters = detailed ? 12 : 4;
  for (let i = 0; i < clusters; i++) {
    const x = left + 0.12 + ((i * 0.37) % 1) * (right - left - 0.24);
    const z = rear + 0.12 + ((i * 0.61) % 1) * (front - rear - 0.24);
    part("leaf", [x, 1.3, z], detailed ? [0.3, 0.08, 0.26] : [0.42, 0.08, 0.4], 3, "sphere");
  }
  if (detailed) for (const [x, z] of [[left + 0.2, rear + 0.35], [right - 0.25, front - 0.3]] as const)
    part("paint", [x, 1.2, z], [0.06, 0.1, 0.06], 3, "sphere", undefined, [0.32, 0.12, 0.35]);
  // A vine trunk climbs the front column.
  part("bark", [right - 0.05, 0.72, front - 0.05], [0.035, 0.95, 0.035], 3, "cylinder");
};

/** Drinking table with benches and an amphora, under the pergola. */
const addYardFurniture = ({ detailed, part }: RomanDesignContext) => {
  const x = 0.88, z = -0.2;
  romanBench(part, x, z, 0.46, 0.34, 0.5);
  addAmphora(part, x + 0.1, 0.53, z, detailed, 0.55);
  if (!detailed) return;
  for (const side of [-1, 1]) romanBench(part, x, z + side * 0.32, 0.46, 0.14, 0.34);
  for (const offset of [-0.1, -0.02])
    part("paint", [x + offset, 0.56, z + 0.06], [0.04, 0.05, 0.04], 3, "cylinder", undefined, TERRACOTTA);
  // Amphora rack against the hall's east wall.
  part("wood", [HALL_RIGHT + 0.11, 0.24, -0.42], [0.14, 0.04, 0.32], 3);
  for (const offset of [-0.09, 0.09]) addAmphora(part, HALL_RIGHT + 0.11, 0.26, -0.42 + offset, detailed, 0.8);
};

/**
 * Delivered recruiting equipment lies on the yard's long bench: each ingredient has its own
 * input place, so carriers visibly stock the Tavern before the recruit is equipped.
 */
const addEquipmentBench = ({ detailed, part }: RomanDesignContext) => {
  const z = EQUIPMENT_BENCH_Z, left = TAVERN_YARD.minX + 0.22;
  part("wood", [left + 0.42, 0.32, z], [0.92, 0.05, 0.22], 3);
  for (const x of [left - 0.02, left + 0.86]) part("wood", [x, 0.25, z], [0.05, 0.14, 0.18], 3);
  TAVERN_INPUT_WARES.forEach((ware, slot) => {
    const center: Point3 = [left + slot * 0.16, 0.345, z];
    // The coarse bow placeholder has gaps between its limb segments; its runtime stock model is compact.
    addPositionedRomanWareStock(part, ware, 0, "input", center, detailed || ware === "bow", Math.PI / 2);
  });
};

export const addRomanTavern = (context: RomanDesignContext) => {
  const { centerX, depth, entryX, height, width } = TAVERN_HALL;
  authorBuildingArchitecture(context.parts, () => {
    romanRoom(context, centerX, 0, width, depth, height, entryX);
    addUpperStorey(context);
    addStreetCounter(context);
    addInnSign(context);
    romanChimney(context.part, -0.78, -0.42, 2.3);
    addPergola(context);
  });
  addYardFurniture(context);
  addEquipmentBench(context);
};

/**
 * Yard decoration of a finished recipe (ground at y = 0): pergola and furniture, which each nation
 * replaces. Walls, roofs, stock places and the equipment bench under them are never decoration.
 */
export const isTavernYardDecor = (part: BuildingPart) => {
  if (part.stock || part.stage < 2 || part.position[1] > 1.25) return false;
  if (part.position[0] < TAVERN_YARD.minX || part.position[0] - part.size[0] / 2 < TAVERN_YARD.minX - 0.05) return false;
  return Math.abs(part.position[2] - EQUIPMENT_BENCH_Z) > 0.13 || part.position[1] > 0.3;
};
