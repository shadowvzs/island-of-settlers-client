import type { I18n, MessageDescriptor, Values } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementPoint } from "../../../shared/settlement/settlement-types";
import type { ShipTargetMode } from "../../settlement-ui/ship-register/troop-types";
import { ARMY_TARGET_MARKER_TONES } from "../army-target/constants";
import type { createArmyOrderMarker } from "../army-target/order-marker";
import { SHIP_REFUSAL } from "./constants";
import {
  shipDestinationAt, shipModePrompt, shipOrderFeedback, shipRightTapMode, translateShipRefusal
} from "./helpers";

export interface ShipTroopOrderOptions {
  i18n?: I18n;
  marker: Pick<ReturnType<typeof createArmyOrderMarker>, "show">;
  message: (message: string, error?: boolean) => void;
  /** The selected ship, its right-tap mode or the armed mode changed: the cursor follows. */
  onChange: () => void;
  pick: (x: number, y: number) => SettlementPoint | null;
  pickTargetBuilding: (x: number, y: number) => SettlementBuilding | undefined;
  simulation: SettlementSimulation;
}

/**
 * Orders for the ship whose window is open (military controls §9.3, P4b): its right tap ("Sail to" on
 * multi-island maps, else land the troops) and the panel's armed target modes ("Sail to", "Unload troops"),
 * which take the next left click and are cancelled by a right click or Escape. A destination is validated with
 * `troopShipDestinationCheck` on the click only (it runs coast searches and sea routes; never on hover), so a
 * refused click is never recorded.
 */
export const createShipTroopOrders = (options: ShipTroopOrderOptions) => {
  const { simulation } = options;
  let selected: number | null = null;
  let armed: ShipTargetMode | null = null;
  let rightTap: ShipTargetMode | null = null;
  const say = (descriptor: MessageDescriptor, values?: Values) =>
    options.message(translateMessage(options.i18n, descriptor, values));
  const refuse = (x: number, y: number, reason: string) => {
    options.marker.show({ x, y }, ARMY_TARGET_MARKER_TONES.refused);
    options.message(translateShipRefusal(reason, options.i18n), true);
    return false;
  };
  /** Re-reads the selected ship's context actions; an armed mode the ship no longer offers ends. */
  const readMode = () => {
    const actions = selected === null ? null : simulation.troopShipActions(selected);
    rightTap = shipRightTapMode(actions);
    if (armed === "sail" && !actions?.sailTo) armed = null;
    if (armed === "unload" && !actions?.unload) armed = null;
  };
  const cursorMode = () => armed ?? rightTap;
  /** True when the order was accepted. */
  const execute = (shipId: number, mode: ShipTargetMode, x: number, y: number) => {
    const destination = shipDestinationAt(options.pickTargetBuilding(x, y), options.pick(x, y));
    if (!destination) return refuse(x, y, SHIP_REFUSAL.pointOnMap);
    const check = simulation.troopShipDestinationCheck(shipId, destination);
    if (!check.ok) return refuse(x, y, check.reason);
    const result = mode === "sail" ? simulation.sailShip(shipId, destination)
      : simulation.landShipTroops(shipId, destination);
    if (!result.ok) return refuse(x, y, result.reason);
    options.marker.show({ x, y }, ARMY_TARGET_MARKER_TONES.move);
    say(shipOrderFeedback(mode, result.kind));
    return true;
  };
  const cancel = () => {
    if (!armed) return;
    armed = null;
    options.onChange();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!armed || event.key !== "Escape") return;
    cancel();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const events = new AbortController();
  window.addEventListener("keydown", onKeyDown, { capture: true, signal: events.signal });
  return {
    armed: () => armed,
    cancel,
    cursorMode,
    /** Arms a panel target mode for the ship (the caller clears the soldier selection first). */
    arm: (shipId: string, mode: ShipTargetMode) => {
      selected = Number(shipId);
      armed = mode;
      readMode();
      if (armed) say(shipModePrompt(mode));
      options.onChange();
    },
    /** A left click while a mode is armed: true when taken (accepted ends the mode, a refusal keeps it). */
    click: (x: number, y: number) => {
      if (!armed || selected === null) return false;
      if (execute(selected, armed, x, y)) cancel();
      return true;
    },
    /** A right tap (long-press) with no soldier selected: the selected ship's order there. */
    order: (x: number, y: number) => {
      if (selected === null || !rightTap) return false;
      execute(selected, rightTap, x, y);
      return true;
    },
    /** The 0.5 s update: the ship may have emptied, boarded or left. */
    refresh: () => {
      const before = cursorMode();
      readMode();
      if (cursorMode() !== before) options.onChange();
    },
    /** The ship window shows this ship (null: closed); changing the ship ends an armed mode. */
    select: (shipId: string | null) => {
      const next = shipId === null ? null : Number(shipId);
      if (next === selected) return;
      selected = next;
      armed = null;
      readMode();
      options.onChange();
    },
    selected: () => selected,
    dispose: () => events.abort()
  };
};

export type ShipTroopOrders = ReturnType<typeof createShipTroopOrders>;
