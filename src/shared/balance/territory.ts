import { buildingsWithRules } from "@shared/catalog/building-data/rules";

/**
 * Territory radii (tiles) claimed by building type (rules sidecar `territoryRadius`): headquarters 48, Barracks
 * 20, Guardhouse 29, Watchtower 39, Fortress 53 and the Catapult Tower 2. Owner decision 2026-10-16: military
 * territory reduced by 20 %, rounding partial tiles up; the headquarters radius 48 was confirmed 2026-10-19.
 */
export const TERRITORY_RADII: Readonly<Record<number, number>> = Object.freeze(Object.fromEntries(
  buildingsWithRules().flatMap(({ entry, rules }) =>
    rules.territoryRadius === undefined ? [] : [[entry.code, rules.territoryRadius]])));
