import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { createExternalStore } from "../../components/ui-store";
import type { ShipDeckPreviewControls, ShipDemoKind } from "../../settlement/ship-demo";
import type { ShipObservationControls } from "../../ship-observation";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementShipSummary } from "../types";
import {
  EMPTY_SHIP_REGISTER, isSameShipRegisterState, resolveRegisterShip, type ShipRegisterState
} from "./helpers";
import type { ShipTroopAction, ShipTroopPort } from "./troop-types";

/** Register commands; the follow camera and the deck preview stay services outside React. */
export interface ShipRegisterActions {
  locate: () => void;
  sink?: () => void;
  step: (offset: -1 | 1) => void;
  toggleFollow: () => void;
  togglePreview: (kind: ShipDemoKind) => void;
  /** The troop panel's actions (Unload troops, Sail to, Return home). */
  troops: (action: ShipTroopAction) => void;
}

export interface SettlementShipWindowOptions {
  i18n?: I18n;
  observation?: ShipObservationControls;
  preview?: ShipDeckPreviewControls;
  /** Troop ships (military controls §9.3): the panel, its actions and the selected ship's map orders. */
  troops?: ShipTroopPort;
  onLocate?: (id: string) => void;
  onSink?: (id: string) => boolean;
}

/**
 * Ship register: the original game's name, cargo and fleet navigation, and the troop panel. Closing stops
 * following the ship, clears the deck preview and ends its map orders; `focus(id)` reselects a ship (and stops
 * the previous one's).
 */
export const createSettlementShipWindow = (
  { i18n, observation, onLocate, onSink, preview, troops }: SettlementShipWindowOptions
) => {
  let ships: readonly SettlementShipSummary[] = [];
  let selected: string | null = null;
  let nation = "roman";
  const state = createExternalStore<ShipRegisterState>(EMPTY_SHIP_REGISTER);
  const leave = (id: string | null) => {
    if (id) observation?.stop(id);
    preview?.clear();
    troops?.select(null);
  };
  const frame = createReactSettlementWindow({
    className: "settlement-ui__ship-window",
    contentClassName: "settlement-ui__overview",
    heading: translateMessage(i18n, M.shipRegister.title),
    id: "settlement-ship-title",
    load: async () => (await import("./mount")).createShipRegisterMount(state, actions),
    onClose: () => leave(selected)
  });
  /** Recomputes while shown only; publishes when something the register renders changed. */
  const publish = () => {
    if (!frame.isOpen()) return;
    const ship = resolveRegisterShip(ships, selected);
    if (selected && selected !== ship?.id) preview?.clear();
    if (ship) selected = ship.id;
    troops?.select(ship?.id ?? null);
    const next: ShipRegisterState = {
      canLocate: Boolean(onLocate),
      canPreview: Boolean(ship && preview?.canPreview(ship.id)),
      followAvailable: Boolean(ship && observation?.canFollow(ship.id)),
      following: Boolean(ship && observation?.isFollowing(ship.id)),
      hasFollow: Boolean(observation),
      hasPreview: Boolean(preview),
      nation,
      position: Math.max(0, ships.indexOf(ship!)),
      previewKind: ship && preview?.active(ship.id),
      ship,
      shipCount: ships.length,
      troops: (ship && troops?.panel(ship.id)) ?? undefined
    };
    if (!isSameShipRegisterState(state.getSnapshot(), next)) state.set(next);
  };
  const actions: ShipRegisterActions = {
    locate: () => { if (selected) onLocate?.(selected); },
    sink: onSink ? () => {
      const ship = resolveRegisterShip(ships, selected);
      if (!ship?.canSink || !onSink(ship.id)) return;
      leave(ship.id);
      selected = null;
      publish();
    } : undefined,
    step: offset => {
      const index = state.getSnapshot().position + offset;
      const target = ships[index];
      if (!target) return;
      leave(selected);
      selected = target.id;
      publish();
    },
    toggleFollow: () => {
      if (!selected) return;
      observation?.toggle(selected);
      publish();
    },
    togglePreview: kind => {
      if (!selected) return;
      preview?.toggle(selected, kind);
      publish();
    },
    troops: action => {
      if (!selected) return;
      troops?.run(selected, action);
      publish();
    }
  };
  return {
    ...frame,
    dispose: () => { preview?.clear(); frame.dispose(); },
    focus: (id: string) => {
      if (selected && selected !== id) leave(selected);
      selected = id;
      frame.open();
      publish();
    },
    update: (next: readonly SettlementShipSummary[] = [], playerNation = nation) => {
      ships = next;
      nation = playerNation;
      publish();
    }
  };
};
