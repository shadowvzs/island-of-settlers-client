import type { MessageDescriptor } from "@lingui/core";

import { SHIP_TROOP_PANEL_MESSAGES as M } from "./troop-messages";
import type { ShipTroopAction, ShipTroopReturnHome } from "./troop-types";

/** The troop panel's "Return home" tooltip per path (colony recall, campaign run end). */
export const SHIP_TROOP_RETURN_TITLES: Record<ShipTroopReturnHome, MessageDescriptor> = {
  campaignRun: M.returnHomeCampaign,
  colonyRecall: M.returnHomeColony
};

/** The troop panel's button icons (existing HUD renders). */
export const SHIP_TROOP_ICONS: Record<ShipTroopAction, string> = { returnHome: "ship", sail: "map", unload: "people" };
