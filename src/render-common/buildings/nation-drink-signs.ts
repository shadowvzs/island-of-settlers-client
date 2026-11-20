import { DMath } from "../../shared/math/deterministic-math";
import type { WorkerNation } from "../workers/worker-unit";
import type { BuildingPart, Point3 } from "./building-recipe";
import type { AddPart } from "./roman-resource-workshops";

/**
 * Nation pictograms on the facade tablet of the drink chain buildings (the Roman tablet shows
 * grapes or the wine press): honey skep / mead horn (Viking), rice sheaf / sake flask (Japanese),
 * coconut palm / toddy jar (Nubian). Same pigment-thin style with a dark keyline as the originals.
 */
export type DrinkSign = "honey" | "mead" | "rice" | "sake" | "coconut" | "toddy";
type Shape = "box" | "paint-ellipse" | "paint-triangle";
/** dx, dy, width, height, angle, colour, shape (tablet centre at 0, 0). */
type Stroke = readonly [number, number, number, number, number, Point3, Shape];

const KEYLINE: Point3 = [0.025, 0.035, 0.04];
const OCHRE: Point3 = [0.95, 0.66, 0.16];
const BROWN: Point3 = [0.42, 0.22, 0.08];
const HORN: Point3 = [0.92, 0.84, 0.62];
const SILVER: Point3 = [0.82, 0.84, 0.86];
const GREEN: Point3 = [0.16, 0.48, 0.12];
const GOLD: Point3 = [0.98, 0.78, 0.22];
const WHITE: Point3 = [0.95, 0.94, 0.9];
const INDIGO: Point3 = [0.1, 0.18, 0.5];
const CLAY: Point3 = [0.78, 0.36, 0.18];

const SIGNS: Record<DrinkSign, readonly Stroke[]> = {
  coconut: [
    [0.01, -0.02, 0.022, 0.11, 0.18, BROWN, "box"],
    ...[-0.9, -0.3, 0.3, 0.9].map((angle): Stroke => [DMath.sin(angle) * 0.04, 0.045, 0.085, 0.022, angle * 0.6,
      GREEN, "box"]),
    [-0.012, 0.022, 0.026, 0.028, 0, BROWN, "paint-ellipse"], [0.018, 0.024, 0.026, 0.028, 0, BROWN, "paint-ellipse"]
  ],
  honey: [
    [0, -0.005, 0.11, 0.11, 0, OCHRE, "paint-ellipse"],
    ...[-0.03, 0, 0.03].map((dy): Stroke => [0, dy, 0.1 - Math.abs(dy) * 1.2, 0.007, 0, BROWN, "box"]),
    [0, -0.045, 0.026, 0.014, 0, BROWN, "box"], [0, 0.058, 0.02, 0.02, 0, OCHRE, "paint-triangle"]
  ],
  mead: [
    [-0.01, 0, 0.15, 0.045, 0.35, HORN, "paint-triangle"],
    [0.055, 0.025, 0.012, 0.05, 0.35, SILVER, "box"], [-0.06, -0.03, 0.012, 0.012, 0, SILVER, "paint-ellipse"]
  ],
  rice: [
    ...[-0.3, -0.12, 0.05, 0.22].map((angle): Stroke => [angle * 0.12, -0.02, 0.008, 0.11, angle, GREEN, "box"]),
    ...[-0.3, -0.12, 0.05, 0.22].map((angle): Stroke => [angle * 0.3 + 0.012, 0.035, 0.022, 0.04, angle - 0.5,
      GOLD, "paint-ellipse"]),
    [0, -0.035, 0.05, 0.01, 0, BROWN, "box"]
  ],
  sake: [
    [0, -0.02, 0.075, 0.085, 0, WHITE, "paint-ellipse"], [0, 0.035, 0.026, 0.05, 0, WHITE, "box"],
    [0, 0.06, 0.034, 0.008, 0, WHITE, "box"], [0, -0.02, 0.07, 0.014, 0, INDIGO, "box"]
  ],
  toddy: [
    [0, -0.02, 0.1, 0.085, 0, CLAY, "paint-ellipse"], [0, 0.035, 0.034, 0.035, 0, CLAY, "box"],
    [0, 0.055, 0.05, 0.01, 0, CLAY, "box"], [0, 0.07, 0.028, 0.02, Math.PI, GREEN, "paint-triangle"]
  ]
};

/** Facade pictograms of slots 5 (the raw ware) and 6 (the drink) per nation; Roman keeps its own. */
const NATION_SIGNS: Partial<Record<WorkerNation, readonly [DrinkSign, DrinkSign]>> = {
  japanese: ["rice", "sake"], nubian: ["coconut", "toddy"], viking: ["honey", "mead"]
};

export const getNationDrinkSign = (id: number, nation: WorkerNation | undefined): DrinkSign | null => {
  const signs = nation ? NATION_SIGNS[nation] : undefined;
  if (!signs || (id !== 5 && id !== 6)) return null;
  return signs[id - 5]!;
};

/** Paints a sign's strokes (keyline under colour) on a tablet face centred at `face`. */
export const addDrinkSignPaint = (part: AddPart, sign: DrinkSign, face: Point3) => {
  for (const [dx, dy, width, height, angle, tint, shape] of SIGNS[sign]) for (const layer of [0, 1])
    part("paint", [face[0] + dx, face[1] + dy, face[2] + 0.002 + layer * 0.002],
      [width + (1 - layer) * 0.007, height + (1 - layer) * 0.007, 0.002], 3, shape, [0, 0, angle],
      layer ? tint : KEYLINE);
};

const TABLET_WIDTH = 0.31;
const TABLET_HEIGHT = 0.18;
const isTablet = (part: BuildingPart) =>
  Math.abs(part.size[0] - TABLET_WIDTH) < 0.001 && Math.abs(part.size[1] - TABLET_HEIGHT) < 0.001;

/** The Roman pictogram on the tablet's face (its coloured edge bands stay). */
const isPictogram = (part: BuildingPart, tablet: BuildingPart) => part.surface === "paint" &&
  part.position[2] > tablet.position[2] + 0.01 && part.size[0] < 0.25 &&
  Math.abs(part.position[0] - tablet.position[0]) < TABLET_WIDTH / 2 &&
  Math.abs(part.position[1] - tablet.position[1]) < TABLET_HEIGHT / 2;

/** Replaces the facade tablet's pictogram with the nation's drink chain symbol. */
export const replaceDrinkSign = (parts: BuildingPart[], sign: DrinkSign): BuildingPart[] => {
  const tablet = parts.find(isTablet);
  if (!tablet) return parts;
  const kept = parts.filter(part => !isPictogram(part, tablet));
  addDrinkSignPaint((surface, position, size, stage = 3, shape = "box", rotation, tint) => {
    kept.push({ position, rotation, shape, size, stage, surface, tint });
  }, sign, [tablet.position[0], tablet.position[1], tablet.position[2] + tablet.size[2] / 2]);
  return kept;
};
