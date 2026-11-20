import { shipDeckCapacity } from "@shared/catalog";

import type { NavalShip } from "./settlement-naval-fleet";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { boxes: SHIP_DECK_BOXES } = shipDeckCapacity();

/**
 * Logistics visitors (owner 2026-10-19): the trade ship, the colony supply ship and the colony resource (ore) ship
 * carry everything in one ship, without the 33-box hold. Their deck shows at most a full hold and the porters'
 * pier time is that of the visible boxes. Expedition fleets, troop ships, reward ships and own ships keep the hold.
 */
const LOGISTICS_ROLES: ReadonlySet<string> = new Set(["ore", "supply", "trade"]);

const isLogisticsVisitor = (ship: NavalShip) =>
  Boolean(ship.visitor) && LOGISTICS_ROLES.has(ship.visitor!.role ?? "supply");

/** Boxes shown on the deck and handled at the pier: a logistics visitor's are capped at one full hold. */
export const visibleDeckBoxes = (ship: NavalShip, boxes: number) =>
  isLogisticsVisitor(ship) ? Math.min(boxes, SHIP_DECK_BOXES) : boxes;
