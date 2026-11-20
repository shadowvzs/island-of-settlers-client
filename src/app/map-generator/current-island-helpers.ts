import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { chooseLandform,type Landform } from "../../shared/world/generation/landforms";
import type { SelectOption } from "../components/helpers";
import type { IslandChoice } from "./helpers";
import { MAP_GENERATOR_MESSAGES as M } from "./messages";
import { getAmountLevels,getLandformOptions,getResourcePresetOptions,getTerrainVariationLevels,getThemeOptions } from "./options";

/** Display name of a select option's value (the form's own labels). */
const getOptionLabel = <T>(options: SelectOption<T>[], value: T) =>
  options.find((option) => option.value === value)?.label ?? String(value);

/** What the running island was generated from (seed, resolved landform, options). */
export interface CurrentIsland {
  choice: IslandChoice;
  /** The landform actually generated (Random resolves through the seed). */
  landform: Landform;
  seed: number;
  size: number;
  height: number;
}

/** The running island: the choice it was generated with, its seed and its real size. */
export const describeCurrentIsland = (
  choice: IslandChoice,
  world: { cellsX: number; cellsZ: number; seed: number; colonyResourceTier?: IslandChoice["colonyResourceTier"] }
): CurrentIsland => ({
  choice: { ...choice, colonyResourceTier: world.colonyResourceTier },
  landform: choice.landform ?? chooseLandform(world.seed),
  seed: world.seed,
  height: world.cellsZ,
  size: world.cellsX
});

const formatAmount = (level: number, i18n?: I18n) =>
  getAmountLevels(i18n)[level] ?? String(level);

const formatLandform = (island: CurrentIsland, i18n?: I18n) => {
  const name = getOptionLabel(getLandformOptions(i18n), island.landform);
  return island.choice.landform === null
    ? translateMessage(i18n, M.current.fromSeed, { name })
    : name;
};

const getIslandRows = (island: CurrentIsland, i18n?: I18n): [string, string][] => [
  [translateMessage(i18n, M.current.seed), String(island.seed)],
  [translateMessage(i18n, M.current.size), `${island.size} x ${island.height}`],
  [translateMessage(i18n, M.current.landform), formatLandform(island, i18n)],
  [translateMessage(i18n, M.current.theme), getOptionLabel(getThemeOptions(i18n), island.choice.theme)],
  [translateMessage(i18n, M.current.resources),
    getOptionLabel(getResourcePresetOptions(i18n), island.choice.colonyResourceTier)],
  [translateMessage(i18n, M.current.rivers),
    translateMessage(i18n, island.choice.rivers ? M.yes : M.no)],
  [translateMessage(i18n, M.current.forest), formatAmount(island.choice.forest, i18n)],
  [translateMessage(i18n, M.current.mountains), formatAmount(island.choice.mountains, i18n)],
  [translateMessage(i18n, M.current.terrainVariation), getTerrainVariationLevels(i18n)[island.choice.terrainVariation ?? 2]!]
];

/** The Current island rows, with the load time once the island has finished loading. */
export const getMapPanelRows = (
  island: CurrentIsland,
  loadMilliseconds?: number,
  i18n?: I18n
): [string, string][] => {
  const rows = getIslandRows(island, i18n);
  if (loadMilliseconds === undefined) return rows;
  return [...rows, [
    translateMessage(i18n, M.current.loadedIn),
    `${(loadMilliseconds / 1000).toFixed(1)} s`
  ]];
};
