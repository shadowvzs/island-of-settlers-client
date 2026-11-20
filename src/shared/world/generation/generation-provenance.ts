import { isNation } from "../../../../../island-of-settlers-shared/src/nations";
import { isSaveObject } from "../../settlement/save-validation";
import { isColonyResourceTier } from "../colony-resource-tiers";
import type { WorldOptions } from "./generate-world";
import { isIslandTheme } from "./island-themes";
import { isLandform } from "./landforms";
import { isThemeLayoutKind } from "./theme-field";

/**
 * Bump whenever generated primary terrain changes; incompatible maps remain editable. v7: Eroded
 * relief and tall summits became the default island choice (MC, owner 2026-11-07). v9: large
 * islands gain gulfs, bays and coves (COAST-NATURAL, owner 2026-11-09). v10: needle summits and
 * knife crests are rounded into rock crowns (WALL-PATCHES, owner review 2026-11-09). v11: river
 * cascades step down in small ledge falls with plunge pools (RIVER-CASCADES TT-6, 2026-11-13).
 */
export const TERRAIN_GENERATOR_VERSION = "terrain-seed-v11";
export interface GenerationProvenance {
  version: 1;
  generatorVersion: string;
  options: Readonly<WorldOptions>;
}
const range = (value: unknown, min: number, max: number, integer = false) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max &&
  (!integer || Number.isSafeInteger(value));
const optionKeys = ["cellsX", "cellsZ", "erosionDroplets", "forest", "landform", "mountains", "nation", "rivers",
  "seed", "theme", "themeLayout", "similarIslandSizes", "islandCount", "mountainProfiles", "mountainScale",
  "mineApronScale", "oreCapacity", "minimumDepositMines", "colonyResourceTier", "homeResources", "treeDensity",
  "treeSpacing", "terrainVariation", "fluvialErosion", "peakUplift", "cliffBands", "harbourSpots"];
export const validGenerationProvenance = (value: unknown): value is GenerationProvenance | undefined => {
  if (value === undefined) return true;
  if (!isSaveObject(value) || value.version !== 1 || typeof value.generatorVersion !== "string" ||
    !value.generatorVersion.length || value.generatorVersion.length > 80 ||
    Object.keys(value).some(key => !["version", "generatorVersion", "options"].includes(key)) ||
    !isSaveObject(value.options)) return false;
  const options = value.options;
  if (options.terrainVariation !== undefined && !range(options.terrainVariation, 0, 2)) return false;
  if (options.fluvialErosion !== undefined && !range(options.fluvialErosion, 0, 1)) return false;
  if (options.peakUplift !== undefined && !range(options.peakUplift, 0, 1)) return false;
  if (options.cliffBands !== undefined && !range(options.cliffBands, 0, 1)) return false;
  if (options.treeSpacing !== undefined &&
    (typeof options.treeSpacing !== "number" || ![1.65, 1.4, 1.2].includes(options.treeSpacing)))
    return false;
  if (Object.keys(options).some(key => !optionKeys.includes(key)) ||
    !range(options.cellsX, 1, 1024, true) || !range(options.cellsZ, 1, 1024, true) ||
    !range(options.seed, 0, 0xffffffff, true) || !range(options.erosionDroplets, 0, 2_000_000, true) ||
    !range(options.forest, 0, 4) || !range(options.mountains, 0, 4) || !range(options.rivers, 0, 16) ||
    (options.landform !== null && !isLandform(options.landform)) || !isIslandTheme(options.theme) ||
    !isThemeLayoutKind(options.themeLayout)) return false;
  if (options.nation !== undefined && !isNation(options.nation)) return false;
  for (const key of ["similarIslandSizes", "mountainProfiles", "oreCapacity", "homeResources", "harbourSpots"])
    if (options[key] !== undefined && typeof options[key] !== "boolean") return false;
  for (const key of ["mountainScale", "mineApronScale", "treeDensity"])
    if (options[key] !== undefined && !range(options[key], 0, 8)) return false;
  if (options.islandCount !== undefined && !range(options.islandCount, 1, 64, true)) return false;
  if (options.minimumDepositMines !== undefined && !range(options.minimumDepositMines, 1, 128, true)) return false;
  return options.colonyResourceTier === undefined || isColonyResourceTier(options.colonyResourceTier);
};
