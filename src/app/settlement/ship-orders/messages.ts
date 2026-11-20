import { msg } from "@lingui/core/macro";

/** Troop ship feedback on the settlement message line (military controls §9, P4a/P4b). */
export const SHIP_ORDER_MESSAGES = {
  boarding: msg({
    id: "settlement.shipOrders.boarding",
    message: "{boarding, plural, one {# soldier boarding.} other {# soldiers boarding.}}"
  }),
  boardingWaiting: msg({
    id: "settlement.shipOrders.boardingWaiting",
    message: "{boarding, plural, one {# soldier boarding} other {# soldiers boarding}}, {waiting, plural, one {# waits} other {# wait}} at the pier (ship full)."
  }),
  landCoast: msg({ id: "settlement.shipOrders.landCoast", message: "The ship sails to the coast and lands the troops." }),
  landHarbour: msg({
    id: "settlement.shipOrders.landHarbour", message: "The troops go ashore at the harbour."
  }),
  pickupCalled: msg({
    id: "settlement.shipOrders.pickupCalled",
    message: "{boarding, plural, one {A troop ship is called for # soldier.} other {A troop ship is called for # soldiers.}}"
  }),
  pickupWaiting: msg({
    id: "settlement.shipOrders.pickupWaiting",
    message: "{boarding, plural, one {A troop ship is called for # soldier} other {A troop ship is called for # soldiers}}; {waiting, plural, one {# waits} other {# wait}} at the harbour (ship full)."
  }),
  sailCoast: msg({
    id: "settlement.shipOrders.sailCoast", message: "The ship sails to the coast and anchors with the troops aboard."
  }),
  sailHarbour: msg({
    id: "settlement.shipOrders.sailHarbour", message: "The ship sails to the harbour and docks with the troops aboard."
  }),
  sailPrompt: msg({
    id: "settlement.shipOrders.sailPrompt",
    message: "Sail to: choose a harbour or a coast. Right click or Escape cancels."
  }),
  unloadPrompt: msg({
    id: "settlement.shipOrders.unloadPrompt",
    message: "Unload troops: choose a coast to land on. Right click or Escape cancels."
  })
} as const;
