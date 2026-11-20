import {
  type HotkeyAction, type HotkeyBindings, type HotkeyEvent, hotkeyEventAllowed
} from "../settings/hotkeys/bindings";
import { type ArmyGroupKey, matchesGroupKey } from "./army-groups/group-keys";
import type { ArmyAction } from "./army-rail/helpers";

/** What an iso-view key press asks of the soldier controls. */
export type MilitaryKeyCommand =
  | { kind: "arm"; order: Exclude<ArmyAction, "return"> }
  | { kind: "group"; key: ArmyGroupKey }
  | { kind: "return" }
  | { kind: "selectAll" };

/** The hotkeys that arm an order for the next map click (the rail's buttons, §5.2). */
const ARMING_HOTKEYS: readonly (readonly [HotkeyAction, Exclude<ArmyAction, "return">])[] = [
  ["armyMove", "move"], ["armyAttackMove", "attack"], ["armyRetreat", "retreat"], ["armyEnter", "enter"]
];

const bound = (action: HotkeyAction, event: HotkeyEvent, bindings: HotkeyBindings) =>
  Boolean(event.code) && bindings[action] === event.code;

/** A rebindable army hotkey (no modifiers), else a control-group digit (plain or Shift). */
export const militaryKeyCommand = (event: HotkeyEvent, bindings: HotkeyBindings): MilitaryKeyCommand | null => {
  if (hotkeyEventAllowed(event)) {
    const arming = ARMING_HOTKEYS.find(([action]) => bound(action, event, bindings));
    if (arming) return { kind: "arm", order: arming[1] };
    if (bound("armyReturn", event, bindings)) return { kind: "return" };
    if (bound("armySelectAll", event, bindings)) return { kind: "selectAll" };
  }
  const key = matchesGroupKey(event, bindings);
  return key ? { kind: "group", key } : null;
};

/** Orders act on the selection; select-all and the control groups work without one. */
export const needsSelection = (command: MilitaryKeyCommand) => command.kind === "arm" || command.kind === "return";
