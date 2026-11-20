import type {
  CampaignEdgeState, CampaignNodeState
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-graph";

/** Soldier portraits fall back to this nation when the snapshot names none. */
export const FALLBACK_NATION = "roman";
/** While the window is visible the launch check is read again at this interval (home stock keeps changing). */
export const REQUIREMENT_REFRESH_MS = 1000;
export const MAP_ROW_CLASS = "campaign-window__map";
export const CHIP_CLASS = "campaign-window__chip";
/** Named HUD icons of a map's state; locked and closed maps read dimmed (campaign-window.css). */
export const STATUS_ICONS: Readonly<Record<CampaignNodeState, string>> = {
  available: "campaign", closed: "cancel", completed: "apply", notAvailable: "campaign"
};
/** Compact path graph (BR4), in CSS pixels: one column per graph layer, one row per map of that layer. */
export const PATH_COLUMN_WIDTH = 84;
export const PATH_ROW_HEIGHT = 64;
/** Node circle centre inside its cell, from the cell's top; the name label sits under the circle. */
export const PATH_NODE_CENTER_Y = 22;
/** Arrows stop this far from a node centre: the 36 px circle's rim plus a little air. */
export const PATH_NODE_GAP = 21;
export const PATH_ARROW_SIZE = { halfWidth: 5, length: 9 };
export const PATH_ARROW_MINIMUM = 2 * PATH_NODE_GAP + PATH_ARROW_SIZE.length;
/** The campaign-end ring of an ending map: offset right/up from the node centre and its radius. */
export const PATH_ENDING_OFFSET_X = 30;
export const PATH_ENDING_OFFSET_Y = -16;
export const PATH_ENDING_RADIUS = 5;
/** Several edges join one pair of maps: the drawn arrow shows the strongest state. */
export const PATH_EDGE_STATE_RANK: Readonly<Record<CampaignEdgeState, number>> = { closed: 0, open: 1, taken: 2 };
export const PATH_NODE_CLASS = "campaign-window__path-node";
export const PATH_EDGE_CLASS = "campaign-window__path";
