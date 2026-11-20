import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { SHIP_TROOP_ICONS, SHIP_TROOP_RETURN_TITLES } from "./constants";
import { SHIP_TROOP_PANEL_MESSAGES as M } from "./troop-messages";
import type { ShipTroopAction, ShipTroopPanelState } from "./troop-types";


/** A compact panel button: a short caption under the icon, the full action name as label, the purpose as title. */
const troopButton = (
  action: ShipTroopAction, text: { caption: string; label: string; title: string }, pressed = false
) => ({ action, ...text, icon: SHIP_TROOP_ICONS[action], pressed });

export type ShipTroopButton = ReturnType<typeof troopButton>;

/** The context actions of §9.3: only those valid on this map (`troopShipActions`), armed modes pressed. */
const troopButtons = (state: ShipTroopPanelState, i18n?: I18n): ShipTroopButton[] => {
  const text = (descriptor: typeof M.unload) => translateMessage(i18n, descriptor);
  const buttons: ShipTroopButton[] = [];
  if (state.unload) buttons.push(troopButton("unload",
    { caption: text(M.unloadCaption), label: text(M.unload), title: text(M.unloadTitle) }, state.armed === "unload"));
  if (state.sailTo) buttons.push(troopButton("sail",
    { caption: text(M.sailTo), label: text(M.sailTo), title: text(M.sailToTitle) }, state.armed === "sail"));
  if (state.returnHome) buttons.push(troopButton("returnHome", { caption: text(M.returnHomeCaption),
    label: text(M.returnHome), title: text(SHIP_TROOP_RETURN_TITLES[state.returnHome]) }));
  return buttons;
};

/** Status lines: aboard and free deck slots, then soldiers still boarding or landing. */
const troopLines = (state: ShipTroopPanelState, i18n?: I18n) => {
  const lines = [translateMessage(i18n, M.aboard, { aboard: state.aboard, capacity: state.capacityLeft })];
  if (state.boarding) lines.push(translateMessage(i18n, M.boarding, { count: state.boarding }));
  if (state.landing) lines.push(translateMessage(i18n, M.landing, { count: state.landing }));
  return lines;
};

const carriesTroops = (state: ShipTroopPanelState) => state.aboard + state.boarding + state.landing > 0;

/** The ship window's troop section; null when the ship neither carries soldiers nor can take any here. */
export const getShipTroopView = (state: ShipTroopPanelState, i18n?: I18n) => {
  const buttons = troopButtons(state, i18n);
  const carrying = carriesTroops(state);
  if (!carrying && !state.board && !buttons.length) return null;
  return {
    buttons,
    heading: translateMessage(i18n, M.heading),
    hint: !carrying && state.board ? translateMessage(i18n, M.boardHint) : undefined,
    lines: troopLines(state, i18n)
  };
};

export type ShipTroopView = NonNullable<ReturnType<typeof getShipTroopView>>;
