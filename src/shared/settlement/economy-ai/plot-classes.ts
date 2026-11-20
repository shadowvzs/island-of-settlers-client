import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { isMineType } from "../settlement-placement";
import { PLOT_CLASS_SPAN, PLOT_KIND_LAND, PLOT_KIND_MINE } from "./constants";

/** A candidate plot class (plan §3.5): the plot kind and the unturned footprint every rotation turns. */
export interface PlotClass {
  depth: number;
  kind: number;
  width: number;
}

const kindOf = (typeId: number) => isMineType(typeId) ? PLOT_KIND_MINE : PLOT_KIND_LAND;

/** The class key of a building type: types with one kind and footprint share one cached plot list. */
export const plotClassKey = (typeId: number) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  return (kindOf(typeId) * PLOT_CLASS_SPAN + width) * PLOT_CLASS_SPAN + depth;
};

export const plotClassOf = (key: number): PlotClass => ({
  depth: key % PLOT_CLASS_SPAN,
  kind: Math.floor(key / (PLOT_CLASS_SPAN * PLOT_CLASS_SPAN)),
  width: Math.floor(key / PLOT_CLASS_SPAN) % PLOT_CLASS_SPAN
});
