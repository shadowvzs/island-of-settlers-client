import { shipDeckCapacity } from "@shared/catalog";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { boxes: SHIP_DECK_BOXES, passengers: SHIP_DECK_SOLDIERS } = shipDeckCapacity();

/** Troop points in campaign validation messages keep two decimals (difficulty factors make long fractions). */
export const TROOP_POINT_PRECISION = 100;
/** One full deck in common deck units (33 boxes × 16): the C1 supply-line limit of a campaign map. */
export const CAMPAIGN_SHIP_CAPACITY = SHIP_DECK_SOLDIERS * SHIP_DECK_BOXES;
/** A new attempt is numbered by the home game clock in whole seconds (C8), so run keys never repeat. */
export const CAMPAIGN_ATTEMPT_CLOCK_MS = 1000;
