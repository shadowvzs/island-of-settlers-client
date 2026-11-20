import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { ROAD_PLACEMENT_WIDTH } from "../../settlement/road-types";
import { BUILDING_FOOTPRINTS, type FootprintKind } from "../building-footprints";
import type { PackingFootprint } from "../building-space";

/** Representative starter estimate only: current HQ and small residence, never a guaranteed town layout. */
export const getStarterPackingFootprints = (): Readonly<Record<FootprintKind, PackingFootprint>> => {
  const footprint = (id: number, kind: "large" | "standard"): PackingFootprint => {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    return { ...BUILDING_FOOTPRINTS[kind], size: Math.max(width, depth), width, depth,
      accessMargin: Math.ceil(ROAD_PLACEMENT_WIDTH) };
  };
  return { large: footprint(0, "large"), standard: footprint(57, "standard"), tower: BUILDING_FOOTPRINTS.tower };
};
