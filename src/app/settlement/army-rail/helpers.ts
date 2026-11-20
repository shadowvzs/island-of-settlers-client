import type { I18n } from "@lingui/core";

import roman1IconUrl from "../../../../assets/building-icons/roman-1.png?url";
import roman29IconUrl from "../../../../assets/building-icons/roman-29.png?url";
import downIconUrl from "../../../../assets/ui-icons/camera/down.png?url";
import rightIconUrl from "../../../../assets/ui-icons/camera/right.png?url";
import upIconUrl from "../../../../assets/ui-icons/camera/up.png?url";
import rallyFlagIconUrl from "../../../../assets/ui-icons/rally-flag.png?url";
import swordIconUrl from "../../../../assets/ware-icons/sword.png?url";
import { translateMessage } from "../../../shared/i18n/translate";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { ARMY_GROUP_ABOARD_MARK } from "../army-groups/constants";
import type { ArmyGroupBadge } from "../army-groups/control-groups";
import { ARMY_RAIL_SELECTION_MESSAGES as M } from "../army-groups/messages";
import { troopIcon, troopTypes } from "../army-icons";

/** Rail buttons that issue an order (or, for return, act at once). */
export type ArmyAction = "move" | "attack" | "retreat" | "return" | "enter";
/** The pending order waiting for a map click. */
export type ArmyOrder = "move" | "attack" | "retreat" | "enter" | "rally" | null;
export type TroopCounts = Readonly<Record<MilitaryTroopType, number>>;

/** What the rail shows; the controller publishes it after every change and refresh. */
export interface ArmyRailState {
  /** Add-to-selection (box select) mode. */
  adding: boolean;
  canEnter: boolean;
  /** Troop type checkboxes of the rally panel (a type without free troops stays checked but disabled). */
  checked: Readonly<Record<MilitaryTroopType, boolean>>;
  free: TroopCounts;
  /** Client-only control groups with soldiers (badges, by digit). */
  groups: readonly ArmyGroupBadge[];
  hasBanner: boolean;
  nation: string;
  order: ArmyOrder;
  rallyOpen: boolean;
  selected: number;
}

const allTroops = <T>(value: T) =>
  Object.fromEntries(troopTypes.map(type => [type, value])) as Record<MilitaryTroopType, T>;

export const INITIAL_ARMY_RAIL_STATE: ArmyRailState = {
  adding: false, canEnter: true, checked: allTroops(true), free: allTroops(0), groups: [], hasBanner: false,
  nation: "roman", order: null, rallyOpen: false, selected: 0
};

/** Free troop counts by type (types missing from the list count zero). */
export const toTroopCounts = (free: readonly { count: number; type: MilitaryTroopType }[]): TroopCounts => {
  const counts = allTroops(0);
  for (const { count, type } of free) counts[type] = count;
  return counts;
};

/** Checked types that have free troops: the types a rally call or gathering sends. */
export const getChosenTypes = ({ checked, free }: Pick<ArmyRailState, "checked" | "free">) =>
  troopTypes.filter(type => checked[type] && free[type] > 0);

const ORDER_INSTRUCTIONS: Record<Exclude<ArmyOrder, null>, string> = {
  attack: "Choose an enemy building or ground to attack.",
  enter: "Choose a friendly military building for infantry.",
  move: "Choose reachable ground for Move.",
  rally: "Choose where to plant the rally banner.",
  retreat: "Choose where to retreat to."
};

/** Screen reader prompt of the pending order. */
export const getOrderInstruction = (order: ArmyOrder) =>
  order ? `${ORDER_INSTRUCTIONS[order]} Press Escape to cancel.` : "Choose a soldier action.";

const ENTER_LABEL = "Enter military building (infantry)";
const ACTION_BUTTONS: readonly { action: ArmyAction; icon: string; label: string }[] = [
  { action: "move", icon: upIconUrl, label: "Move" },
  { action: "attack", icon: swordIconUrl, label: "Attack / attack move" },
  { action: "retreat", icon: downIconUrl, label: "Retreat (ignores enemies)" },
  { action: "return", icon: roman29IconUrl, label: "Return to closest storehouse" },
  { action: "enter", icon: roman1IconUrl, label: ENTER_LABEL }
];

export interface ArmyActionButton {
  action: ArmyAction;
  disabled: boolean;
  icon: string;
  label: string;
  pressed: boolean;
  title: string;
}

/** The key text of each order button's hotkey ("M"); absent while the hotkey hints are hidden or unbound. */
export type ArmyRailHotkeys = Partial<Record<ArmyAction, string>>;

/** A tooltip that lists its binding (§11): "Move (M)". */
const withHotkey = (title: string, key: string | undefined) => key ? `${title} (${key})` : title;

const getEnterTitle = (canEnter: boolean) => canEnter ? ENTER_LABEL : "Select foot soldiers to enter a military building";

/** The pending order is pressed; garrison entry requires an eligible selected foot soldier. */
export const getActionButtons = ({ canEnter, order }: ArmyRailState, hotkeys: ArmyRailHotkeys = {}):
  ArmyActionButton[] =>
  ACTION_BUTTONS.map(({ action, icon, label }) => {
    const enter = action === "enter";
    const title = enter ? getEnterTitle(canEnter) : label;
    return {
      action, disabled: enter && !canEnter, icon, label, pressed: order === action,
      title: withHotkey(title, hotkeys[action])
    };
  });

/** A badge's text: "1·5", and "1·3 ⚓2" while two members are aboard a ship. */
const groupBadgeText = ({ aboard, count, digit }: ArmyGroupBadge) => {
  if (!aboard) return `${digit}·${count}`;
  return `${digit}·${count} ${ARMY_GROUP_ABOARD_MARK}${aboard}`;
};

/** One rail badge per control group: its digit, and an accessible name that teaches the keys. */
const getGroupBadges = (groups: readonly ArmyGroupBadge[], i18n?: I18n) => groups.map(badge => ({
  digit: badge.digit,
  label: translateMessage(i18n, badge.aboard ? M.groupBadgeAboard : M.groupBadge, { ...badge }),
  text: groupBadgeText(badge)
}));

export interface TroopTypeChoice {
  checked: boolean;
  count: string;
  disabled: boolean;
  icon: string;
  label: string;
  type: MilitaryTroopType;
}

/** One checkbox per troop type with its free count and the nation's portrait. */
const getTroopTypeChoices = ({ checked, free, nation }: ArmyRailState): TroopTypeChoice[] =>
  troopTypes.filter(type => type !== "cavalry" || free[type] > 0).map(type => ({
    checked: checked[type], count: String(free[type]), disabled: free[type] === 0,
    icon: troopIcon(nation, type), label: `Select ${type} soldiers`, type
  }));

/** The locale and hotkey texts the rail labels depend on. */
export interface ArmyRailContext {
  hotkeys?: ArmyRailHotkeys;
  i18n?: I18n;
}

/** Everything the rail view renders, prepared from the state. */
export const getArmyRailView = (state: ArmyRailState, { hotkeys = {}, i18n }: ArmyRailContext = {}) => ({
  actions: getActionButtons(state, hotkeys),
  actionsHidden: state.selected === 0,
  addPressed: state.adding,
  boxSelectLabel: translateMessage(i18n, M.boxSelect),
  boxSelectTitle: translateMessage(i18n, M.boxSelectTitle),
  cancelRallyHidden: !state.hasBanner,
  choices: getTroopTypeChoices(state),
  emptyHidden: troopTypes.some(type => state.free[type] > 0),
  gatherDisabled: getChosenTypes(state).length === 0,
  gatherHidden: !state.hasBanner,
  gatherIcons: [rightIconUrl, rallyFlagIconUrl],
  groups: getGroupBadges(state.groups, i18n),
  groupsHeading: translateMessage(i18n, M.groupsHeading),
  groupsHidden: state.groups.length === 0,
  instruction: getOrderInstruction(state.order),
  rallyFlagIcon: rallyFlagIconUrl,
  rallyHidden: !state.rallyOpen,
  selectedCount: state.selected ? String(state.selected) : "",
  selectionIcon: troopIcon(state.nation, "shield"),
  sendPressed: state.order === "rally"
});

export type ArmyRailView = ReturnType<typeof getArmyRailView>;
