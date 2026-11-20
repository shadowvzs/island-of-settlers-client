import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { COLONY_RESOURCE_TIERS, type ColonyResourceTier } from "../../shared/world/colony-resource-tiers";
import type { IslandTheme } from "../../shared/world/generation/island-themes";
import type { Landform } from "../../shared/world/generation/landforms";
import type { ThemeLayoutKind } from "../../shared/world/generation/theme-field";
import type { SelectOption } from "../components/helpers";
import { MAP_SIZES, type Peaks, type Relief } from "./helpers";
import { MAP_GENERATOR_MESSAGES as M } from "./messages";

export const getTerrainVariationLevels = (i18n?: I18n) =>
  [M.terrainVariation.flat, M.terrainVariation.rolling, M.terrainVariation.natural,
    M.terrainVariation.hilly, M.terrainVariation.veryHilly].map(message => translateMessage(i18n, message));

export const getReliefOptions = (i18n?: I18n): SelectOption<Relief>[] => [
  { label: translateMessage(i18n, M.relief.massif), value: "massif" },
  { label: translateMessage(i18n, M.relief.eroded), value: "eroded" }
];

export const getPeakOptions = (i18n?: I18n): SelectOption<Peaks>[] => [
  { label: translateMessage(i18n, M.peaks.classic), value: "classic" },
  { label: translateMessage(i18n, M.peaks.tall), value: "tall" }
];

export const getLandformOptions = (i18n?: I18n): SelectOption<Landform | null>[] => [
  { label: translateMessage(i18n, M.landform.random), value: null },
  { label: translateMessage(i18n, M.landform.archipelago), value: "archipelago" },
  { label: translateMessage(i18n, M.landform.peninsula), value: "peninsula" }
];

export const getThemeOptions = (i18n?: I18n): SelectOption<IslandTheme>[] => [
  { label: translateMessage(i18n, M.theme.meadow), value: "meadow" },
  { label: translateMessage(i18n, M.theme.desert), value: "desert" },
  { label: translateMessage(i18n, M.theme.dirt), value: "dirt" },
  { label: translateMessage(i18n, M.theme.snowy), value: "snowy" }
];

export const getResourcePresetOptions = (i18n?: I18n): SelectOption<ColonyResourceTier | undefined>[] => [
  { label: translateMessage(i18n, M.resource.home), value: undefined },
  ...COLONY_RESOURCE_TIERS.map(pair => ({
    label: translateMessage(i18n, M.resource.colony, {
      tier: pair.tier,
      wood: translateMessage(i18n, M.wood[pair.wood]),
      stone: translateMessage(i18n, M.stone[pair.stone])
    }),
    value: pair.tier
  }))
];

export const getThemeLayoutOptions = (i18n?: I18n): SelectOption<ThemeLayoutKind>[] => [
  { label: translateMessage(i18n, M.layout.uniform), value: "uniform" },
  { label: translateMessage(i18n, M.layout.landmass), value: "landmass" },
  { label: translateMessage(i18n, M.layout.altitude), value: "altitude" },
  { label: translateMessage(i18n, M.layout.latitude), value: "latitude" },
  { label: translateMessage(i18n, M.layout.regions), value: "regions" }
];

export const SIZE_OPTIONS: SelectOption<number>[] = MAP_SIZES.map((size) => ({
  label: String(size),
  value: size
}));

export const getTreeSpacingOptions = (i18n?: I18n): SelectOption<number>[] => [
  { label: translateMessage(i18n, M.forestDensity.normal), value: 1.65 },
  { label: translateMessage(i18n, M.forestDensity.dense), value: 1.4 },
  { label: translateMessage(i18n, M.forestDensity.veryDense), value: 1.2 }
];

export const getAmountLevels = (i18n?: I18n): string[] => [
  translateMessage(i18n, M.amount.none),
  translateMessage(i18n, M.amount.few),
  translateMessage(i18n, M.amount.normal),
  translateMessage(i18n, M.amount.many),
  translateMessage(i18n, M.amount.veryMany)
];

export const getRiverLevels = (i18n?: I18n): string[] => [
  translateMessage(i18n, M.river.off),
  translateMessage(i18n, M.river.few),
  translateMessage(i18n, M.river.normal)
];
