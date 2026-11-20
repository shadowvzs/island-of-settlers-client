import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { AdventureTheme } from "../../shared/settlement/adventure-themes";
import { type DiscoveredIsland,isOffSeasonDiscovery } from "../../shared/settlement/island-discovery-policy";
import { joinDetails } from "../components/helpers";
import { SETTLEMENT_MESSAGES as M } from "./messages";

const THEME_NAMES = {
  tropical: M.climate.tropical, forest: M.climate.forest, winter: M.climate.winter,
  desert: M.climate.desert, swamp: M.climate.swamp
} as const satisfies Record<AdventureTheme, unknown>;

/** Show the committed discovery, never today's calendar: old islands retain their saved route. */
export const islandClimateLabel = (island: DiscoveredIsland, i18n?: I18n) =>
  island.theme ? translateMessage(i18n, THEME_NAMES[island.theme]) : "";
export const islandClimateTooltip = (island: DiscoveredIsland, i18n?: I18n) =>
  joinDetails(islandClimateLabel(island, i18n),
    isOffSeasonDiscovery(island) ? translateMessage(i18n, M.climate.distant) : "",
    island.discovery?.debug ? translateMessage(i18n, M.climate.debug) : "");
