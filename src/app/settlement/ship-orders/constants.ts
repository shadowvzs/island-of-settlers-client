import type { MessageDescriptor } from "@lingui/core";

import type { ShipTargetMode } from "../../settlement-ui/ship-register/troop-types";
import { SHIP_ORDER_MESSAGES as M } from "./messages";

/** Where a troop ship order goes: a harbour pier or a coast. */
export type ShipDestinationKind = "coast" | "harbour";

/** The simulation's own refusals, kept as the English source sentence (translated where shown). */
export const SHIP_REFUSAL = {
  full: "The ship is full",
  noneCanBoard: "No chosen soldier can board",
  pointOnMap: "Choose a point on the map"
} as const;

/** The accepted order's feedback per mode and destination: sailed with the troops aboard, or landed. */
export const SHIP_ORDER_FEEDBACK: Record<ShipTargetMode, Record<ShipDestinationKind, MessageDescriptor>> = {
  sail: { coast: M.sailCoast, harbour: M.sailHarbour },
  unload: { coast: M.landCoast, harbour: M.landHarbour }
};
