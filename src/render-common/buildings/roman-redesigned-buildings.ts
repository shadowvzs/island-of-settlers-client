import type { BuildingDefinition } from "./building-catalog";
import type { Point3 } from "./building-recipe";
import {
  addRomanFortress,
  addRomanWatchtower,
  type RomanMilitaryAnchors
} from "./roman-civic-military";
import { addRomanCommanderLodge } from "./roman-commander-lodge";
import {
  addRomanArmory,
  addRomanBrewery,
  addRomanLeatherWorkshop,
  addRomanMint
} from "./roman-craft-designs";
import type { RomanDesignContext } from "./roman-design-kit";
import { addRomanCivicHeadquarters } from "./roman-headquarters";
import {
  addRomanCharburner,
  addRomanHarbor,
  addRomanMine,
  addRomanShipyard,
  addRomanStorehouse
} from "./roman-logistics-mines";
import {
  addRomanBigResidence, addRomanMediumResidence, addRomanSmallResidence, BIG_RESIDENCE, MEDIUM_RESIDENCE, SMALL_RESIDENCE
} from "./roman-residences";
import {
  addRomanFarm,
  addRomanPigFarm,
  addRomanVineyard,
  addRomanWinery
} from "./roman-rural-designs";
import { addRomanTavern, TAVERN_HALL } from "./roman-tavern";

/** Occupation layouts are explicit: never derive all buildings from the same cottage facade. */
export const ROMAN_REDESIGNED_LAYOUTS: Record<
  number,
  {
    width: number;
    depth: number;
    height: number;
    entryX: number;
  }
> = {
  0: { width: 2.22, depth: 1.68, height: 1.38, entryX: 0 },
  3: { width: 1.4, depth: 0.98, height: 0.98, entryX: -0.28 },
  4: { width: 1.3, depth: 1.12, height: 1.6, entryX: 0 },
  5: { width: 1.34, depth: 0.7, height: 1.13, entryX: -0.28 },
  6: { width: 1.42, depth: 1.24, height: 1.06, entryX: -0.34 },
  8: { width: 1.65, depth: 1.28, height: 0.98, entryX: 0.32 },
  9: { width: 2.84, depth: 1.56, height: 1.52, entryX: 0 },
  10: { width: 1.17, depth: 0.68, height: 1.31, entryX: -0.17 },
  11: { width: 1.17, depth: 0.68, height: 1.31, entryX: -0.17 },
  12: { width: 1.17, depth: 0.68, height: 1.31, entryX: -0.17 },
  13: { width: 1.17, depth: 0.68, height: 1.31, entryX: -0.17 },
  15: { width: 1.4, depth: 1.28, height: 1.28, entryX: -0.28 },
  23: { width: 1.05, depth: 0.7, height: 1.44, entryX: 0.1 },
  24: { width: 1.4, depth: 1.38, height: 1.03, entryX: -0.3 },
  27: { width: 1.05, depth: 0.76, height: 0.92, entryX: -0.64 },
  28: { width: 1.55, depth: 0.94, height: 0.94, entryX: -0.42 },
  29: { width: 1.7, depth: 1.55, height: 1.62, entryX: -0.32 },
  34: { width: 1.35, depth: 0.8, height: 1.3, entryX: -0.22 },
  36: { width: 0.96, depth: 0.96, height: 1.21, entryX: -0.72 },
  37: { width: 1.4, depth: 1.18, height: 1.34, entryX: -0.52 },
  39: { width: 1.9, depth: 0.95, height: 1.1, entryX: -0.4 },
  40: { width: TAVERN_HALL.width, depth: TAVERN_HALL.depth, height: TAVERN_HALL.height, entryX: TAVERN_HALL.entryX },
  57: SMALL_RESIDENCE,
  58: MEDIUM_RESIDENCE,
  59: BIG_RESIDENCE,
  62: { width: 1.55, depth: 1.15, height: 1.02, entryX: 0.05 }
};
export const addRomanRedesignedBuilding = (
  definition: BuildingDefinition,
  context: RomanDesignContext,
  mechanism: Point3
): RomanMilitaryAnchors => {
  const id = definition.id;
  if (id === 0) return addRomanCivicHeadquarters(context);
  if (id === 4) return addRomanWatchtower(context);
  if (id === 9) return addRomanFortress(context);
  if ([3, 8, 15].includes(id)) addRomanLeatherWorkshop(context, id);
  if (id === 5) addRomanVineyard(context);
  if (id === 6) {
    addRomanWinery(context);
    mechanism.splice(0, 3, 0.87, 0.64, -0.13);
  }
  if ([10, 11, 12, 13].includes(id)) {
    addRomanMine(context, id);
    mechanism.splice(0, 3, 0.88, 0.75, -0.2);
  }
  if (id === 23) {
    addRomanBrewery(context);
    mechanism.splice(0, 3, 0.81, 1.17, 0.35);
  }
  if (id === 24) {
    addRomanArmory(context);
    mechanism.splice(0, 3, 1.15, 1.0, 0.54);
  }
  if (id === 27) addRomanCharburner(context);
  if (id === 28) addRomanPigFarm(context);
  if ([29, 39].includes(id)) {
    if (id === 29) addRomanStorehouse(context);
    else {
      addRomanHarbor(context);
      mechanism.splice(0, 3, 1.18, 0.65, 0.58);
    }
  }
  if (id === 34) {
    addRomanMint(context);
    mechanism.splice(0, 3, 0.76, 1.14, 0.5);
  }
  if (id === 36) {
    addRomanShipyard(context);
    mechanism.splice(0, 3, 1.3, 0.65, -0.8);
  }
  if (id === 37) addRomanFarm(context);
  if (id === 40) addRomanTavern(context);
  if (id === 57) addRomanSmallResidence(context);
  if (id === 58) addRomanMediumResidence(context);
  if (id === 59) addRomanBigResidence(context);
  if (id === 62) addRomanCommanderLodge(context);
  return {};
};
