import { msg } from "@lingui/core/macro";

/** The ship window's troop panel (status and context actions). */
export const SHIP_TROOP_PANEL_MESSAGES = {
  aboard: msg({
    id: "ship.troops.aboard",
    message: "{aboard, plural, one {# soldier aboard} other {# soldiers aboard}} · {capacity, plural, one {# free deck slot} other {# free deck slots}}"
  }),
  boardHint: msg({
    id: "ship.troops.boardHint", message: "Select soldiers and right-click this ship to board."
  }),
  boarding: msg({
    id: "ship.troops.boarding", message: "{count, plural, one {# soldier boarding} other {# soldiers boarding}}"
  }),
  heading: msg({ id: "ship.troops.heading", message: "Troops" }),
  landing: msg({
    id: "ship.troops.landing", message: "{count, plural, one {# soldier landing} other {# soldiers landing}}"
  }),
  returnHome: msg({ id: "ship.troops.returnHome", message: "Return home" }),
  returnHomeCaption: msg({ id: "ship.troops.returnHomeCaption", message: "Home" }),
  returnHomeCampaign: msg({
    id: "ship.troops.returnHomeCampaign", message: "Sail home and end the campaign run."
  }),
  returnHomeColony: msg({
    id: "ship.troops.returnHomeColony", message: "Call a troop ship and sail the island's soldiers home."
  }),
  sailTo: msg({ id: "ship.troops.sailTo", message: "Sail to" }),
  sailToTitle: msg({
    id: "ship.troops.sailToTitle", message: "Choose a harbour or a coast on any island of this map."
  }),
  unload: msg({ id: "ship.troops.unload", message: "Unload troops" }),
  unloadCaption: msg({ id: "ship.troops.unloadCaption", message: "Unload" }),
  unloadTitle: msg({ id: "ship.troops.unloadTitle", message: "Choose a coast where the troops land." })
} as const;
