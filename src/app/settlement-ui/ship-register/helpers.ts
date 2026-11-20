import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { translateMessage } from "../../../shared/i18n/translate";
import { isShallowEqual } from "../../components/ui-store";
import { troopPortrait } from "../../settlement/army-icons";
import type { ShipDemoKind } from "../../settlement/ship-demo";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { shipJourneyLabel } from "../ship-journey-label";
import { type ShipPassengerRow, shipPassengerRows } from "../ship-window-helpers";
import type { SettlementShipSummary } from "../types";
import { shipPortrait } from "./ship-portrait";
import { getShipTroopView } from "./troop-panel";
import type { ShipTroopPanelState } from "./troop-types";

const GO_TO_PLACE_ICON = new URL("../../../../assets/ui-icons/go-to-place.svg", import.meta.url).href;
const RELIEF_MISSION = msg({ id: "ship.relief.mission", message: "Disaster relief · {quest}" });
const RELIEF_NAME = msg({ id: "ship.relief.name", message: "Relief collection ship" });

/** What the register shows: the chosen ship of the fleet and its camera / deck preview state. */
export interface ShipRegisterState {
  canLocate: boolean;
  canPreview: boolean;
  followAvailable: boolean;
  following: boolean;
  /** Absent without ship observation (no follow button). */
  hasFollow: boolean;
  /** Absent without the debug deck preview. */
  hasPreview: boolean;
  nation: string;
  position: number;
  previewKind?: ShipDemoKind;
  ship?: SettlementShipSummary;
  shipCount: number;
  /** The troop panel of an own ship (absent without troop ships). */
  troops?: ShipTroopPanelState;
}

export const EMPTY_SHIP_REGISTER: ShipRegisterState = {
  canLocate: false, canPreview: false, followAvailable: false, following: false, hasFollow: false,
  hasPreview: false, nation: "roman", position: 0, shipCount: 0
};

/** The selected ship, else the first one (the register's fallback when a ship leaves the island). */
export const resolveRegisterShip = (ships: readonly SettlementShipSummary[], selected: string | null) =>
  ships.find(entry => entry.id === selected) ?? ships[0];

/** Field by field; the cargo / passenger / troop records compare count by count. */
const isSameShip = (left?: SettlementShipSummary, right?: SettlementShipSummary) => {
  if (!left || !right) return left === right;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]) as Set<keyof SettlementShipSummary>;
  return [...keys].every(key => isShallowEqual(left[key], right[key]));
};

/** Equal when nothing the register renders changed (re-published ship and troop objects compare by value). */
export const isSameShipRegisterState = (left: ShipRegisterState, right: ShipRegisterState) => {
  const { ship, troops, ...fields } = left;
  const { ship: other, troops: otherTroops, ...otherFields } = right;
  return isShallowEqual(fields, otherFields) && isSameShip(ship, other) && isShallowEqual(troops, otherTroops);
};

/** One icon box for every passenger: troop renders and the settlers icon share size and grid. */
export const PASSENGER_ICON_CLASS = "settlement-ui__passenger-icon";

const getPassengerCell = (nation: string, row: ShipPassengerRow) => ({
  count: String(row.count),
  icon: row.troop && troopPortrait(nation, row.troop),
  iconClassName: PASSENGER_ICON_CLASS,
  job: row.troop ?? row.label,
  label: row.label,
  title: `${row.label}: ${row.count}`
});

export type ShipPassengerCell = ReturnType<typeof getPassengerCell>;

const PREVIEW_KINDS = [
  { icon: "statistics", kind: "wares", label: M.shipRegister.demoWares },
  { icon: "people", kind: "settlers", label: M.shipRegister.demoSettlers }
] as const;

const getPreviewButtons = (state: ShipRegisterState, i18n?: I18n) => PREVIEW_KINDS.map(({ icon, kind, label }) => {
  const text = translateMessage(i18n, label);
  return {
    disabled: !state.canPreview,
    icon,
    kind,
    label: text,
    pressed: state.previewKind === kind,
    title: translateMessage(i18n, M.shipRegister.previewTitle, { label: text })
  };
});

export type ShipPreviewButton = ReturnType<typeof getPreviewButtons>[number];

const followCaption = (following: boolean, i18n?: I18n) => translateMessage(i18n,
  following ? M.shipRegister.stopFollowing : M.shipRegister.follow);

/** Everything the register renders for one ship; null when the island has no ships. */
export const getShipRegisterView = (state: ShipRegisterState, i18n?: I18n) => {
  const { nation, position, ship, shipCount } = state;
  if (!ship) return null;
  return {
    follow: state.hasFollow && {
      disabled: !state.followAvailable, label: followCaption(state.following, i18n), pressed: state.following
    },
    canSink: ship.canSink === true && ship.owned !== false,
    goToPlaceIcon: GO_TO_PLACE_ICON,
    journey: shipJourneyLabel(ship, i18n),
    locateDisabled: !state.canLocate,
    name: ship.reliefQuestId ? translateMessage(i18n, RELIEF_NAME) : ship.name,
    reliefMission: ship.reliefQuestId ? translateMessage(i18n, RELIEF_MISSION, { quest: ship.reliefQuestId }) : undefined,
    nextDisabled: position >= shipCount - 1,
    navigation: ship.owned !== false,
    passengers: shipPassengerRows(ship, nation).map(row => getPassengerCell(nation, row)),
    portrait: shipPortrait(ship, nation),
    preview: state.hasPreview && { open: Boolean(state.previewKind), buttons: getPreviewButtons(state, i18n) },
    previousDisabled: position <= 0,
    status: translateMessage(i18n, M.shipRegister.status, {
      count: shipCount, position: position + 1, status: ship.status.replaceAll("_", " ")
    }),
    troops: state.troops && getShipTroopView(state.troops, i18n),
    wares: ship.wares ?? {}
  };
};

export type ShipRegisterView = NonNullable<ReturnType<typeof getShipRegisterView>>;
