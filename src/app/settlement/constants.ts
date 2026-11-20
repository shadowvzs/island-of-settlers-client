import type { CampaignProgress } from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { SaveTimers } from "../save-store/save-coordinator";

/** Declared home reward submission (TRG7): pending claims are looked at every this many ticks (1 s at 20 Hz). */
export const HOME_CLAIM_SYNC_TICKS = 20;
export const HOME_CLAIM_FIRST_RETRY_MS = 2000;
export const HOME_CLAIM_MAX_RETRY_MS = 60_000;
export const HOME_CLAIM_LOG_PREFIX = "[home-claims]";
export const HOME_CLAIM_TIMERS: SaveTimers = {
  clear: handle => clearTimeout(handle), set: (run, ms) => setTimeout(run, ms)
};
/** English domain refusals of a campaign departure (C8). */
export const CAMPAIGN_NOT_HOME = "Campaigns start from the home island";
export const CAMPAIGN_MAP_FILE_MISSING = "The campaign map file could not be read";
export const CAMPAIGN_MAP_FILE_DAMAGED = "The downloaded campaign map file is damaged";
/** The campaign bundle's folder under the page's base URL (`public/campaigns/`, CAMP-BUNDLE). */
export const CAMPAIGN_BUNDLE_FOLDER = "campaigns";
/** Guests and offline play know no completed campaign map: only the campaign graph decides the lock state. */
export const NO_CAMPAIGN_PROGRESS: CampaignProgress = new Map();
/** Campaign record texts (names, exits) fall back to English when no locale is active (tests, tools). */
export const CAMPAIGN_TEXT_FALLBACK_LOCALE = "en";
/** Prompts of an armed soldier order (the rail buttons and their hotkeys). */
export const ARMY_ORDER_PROMPTS = {
  move: "Choose clear ground. Soldiers will move there.",
  retreat: "Choose clear ground. Soldiers retreat there and ignore enemies on the way.",
  attack: "Choose an enemy building to siege, or ground for an attack move.",
  enter: "Choose your military building."
};
/** The soldier rail keeps these events from the map below it. */
export const ARMY_RAIL_ISOLATED_EVENTS = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"];
/** The feedback of an accepted soldier order. */
export const ARMY_ORDER_ACCEPTED = "Order accepted.";
/**
 * EAI5b per-owner pools of the fast offline economy: a computer economy's wares carry this tag and its faction in
 * the island's ledger (`logs@2`).
 */
export const OFFLINE_OWNER_WARE_TAG = "@";
/** Flax farms produce through the player's explicit flax-plot model only (offline economy). */
export const OFFLINE_FLAX_FARM_TYPE = 60;
