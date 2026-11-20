import { entriesInFamily, getContentEntry } from "@shared/catalog";

import {
  type MapRegion, rasterizeRegion
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import {
  isWildlifeSubject, wildlifePinnedRegionIds
} from "../../../../../island-of-settlers-shared/src/script/engine/region-watch";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { CellRegion } from "../../world/grid-geometry";

/**
 * Wildlife pins (trigger design §6.4, TRG3b): the regions an animal-subject enter/leave event names. Their animals
 * are announced by the region watch, and the habitat regions around them stay awake. Derived from the script
 * alone (the same rule as the validator's limit warning), so a script without such events pins nothing and its
 * wildlife simulation is unchanged.
 */

const CATALOG = { entry: getContentEntry, family: entriesInFamily };

/** Regions of animal-subject enter/leave events, in the script's region order. */
export const wildlifeRegions = (script: MapScript): MapRegion[] => {
  const ids = new Set(wildlifePinnedRegionIds(script, subject => isWildlifeSubject(subject, CATALOG)));
  return script.regions.filter(region => ids.has(region.id));
};

/** The cell bounds of each region on the map (empty regions are left out). */
export const regionBounds = (regions: readonly MapRegion[], cellsX: number, cellsZ: number): CellRegion[] =>
  regions.flatMap(region => {
    const cells = rasterizeRegion(region, cellsX, cellsZ);
    if (!cells.length) return [];
    let minX = cellsX, minZ = cellsZ, maxX = -1, maxZ = -1;
    for (const cell of cells) {
      const x = cell % cellsX, z = Math.floor(cell / cellsX);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return [{ maxX, maxZ, minX, minZ }];
  });
