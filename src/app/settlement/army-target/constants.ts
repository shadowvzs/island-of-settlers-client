import { GARRISON_CAPACITIES } from "../../../shared/balance/military";
import { STORAGE_IDS } from "../../../shared/settlement/production-rules";
import type { ArmyCursorMode } from "../army-order-cursor";
import type { ArmyTarget } from "./helpers";

/** Seconds-scale feedback: an order marker shows this long at the clicked point (military controls §6). */
export const ARMY_TARGET_MARKER_MS = 600;
/** The ring / cross colour family of each order kind (CSS `data-order` values). */
export const ARMY_TARGET_MARKER_TONES = {
  attack: "attack",
  move: "move",
  refused: "refused",
  retreat: "retreat",
  station: "station"
} as const;
/** The catalogue tables a building's soldier-order role is read from. */
export const ARMY_TARGET_CATALOGUE = {
  garrisonCapacity: (typeId: number) => GARRISON_CAPACITIES[typeId] ?? 0,
  isStorage: (typeId: number) => STORAGE_IDS.has(typeId)
};
/** The soldiers' target hover resolves at most this often (military controls P3: ≤ every 100 ms). */
export const ARMY_HOVER_INTERVAL_MS = 100;
/** Keys that change the smart order under a still mouse (Ctrl retreats, Alt moves): the hover re-reads them. */
export const ARMY_ORDER_MODIFIER_KEYS: ReadonlySet<string> = new Set(["Alt", "Control"]);
/** The cursor of each smart target kind besides ground (by its mode) and attacks; null keeps the neutral cursor. */
export const ARMY_TARGET_CURSORS: Partial<Record<ArmyTarget["kind"], ArmyCursorMode | null>> = {
  board: "board",
  boardRefused: "invalid",
  garrison: "enter",
  noGround: "invalid",
  ownSoldier: null,
  siege: "siege",
  store: "store",
  targetUnit: "target"
};
/** The SVG namespace of the Shift-queue waypoint overlay's elements. */
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** Radius (CSS px) of one queued step's dot. */
export const ARMY_QUEUE_WAYPOINT_RADIUS = "5";
