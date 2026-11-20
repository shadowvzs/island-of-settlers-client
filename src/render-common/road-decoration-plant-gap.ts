import { ROAD_DECORATIONS } from "../shared/settlement/road-decoration-catalog";
import { roadDecorationClearance } from "./road-decoration-clearance";

export const SMALL_ROAD_DECORATION_MARGIN = .04;
let measuredGap: number | undefined;

/** One cold configuration measurement, not a per-frame validation loop. Includes crown/lantern roof. */
export const minimumRoadDecorationPlantGap = () => {
  if (measuredGap !== undefined) return measuredGap;
  const eligible = ROAD_DECORATIONS.filter(definition => definition.family === "flower-pot" || definition.family === "stone-lantern");
  const maximum = Math.max(...eligible.map(definition => {
    const volumes = roadDecorationClearance(definition).volumes;
    return Math.max(...volumes.map(box => box.max[2])) - Math.min(...volumes.map(box => box.min[2]));
  }));
  measuredGap = Math.ceil((maximum + SMALL_ROAD_DECORATION_MARGIN * 2) * 10) / 10;
  return measuredGap;
};

export const roadPlantEdgeGap = (diameterA: number, diameterB: number) => {
  if (![diameterA, diameterB].every(value => Number.isFinite(value) && value >= 0))
    throw new Error("Invalid roadside plant diameter");
  return Math.max(diameterA, diameterB, minimumRoadDecorationPlantGap());
};
