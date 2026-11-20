import {
  HOTKEY_ACTIONS, HOTKEY_DEFAULTS, type HotkeyBindings, type HotkeyEvent
} from "../../settings/hotkeys/bindings";
import { ARMY_GROUP_KEY_CODE } from "./constants";

/** A control-group key press: recall the group, or assign the selection to it (Shift). */
export interface ArmyGroupKey {
  assign: boolean;
  digit: number;
}

const isEditable = (target: HotkeyEvent["target"]) => {
  const element = target as { isContentEditable?: boolean; tagName?: string } | null;
  return Boolean(element?.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(element?.tagName ?? "");
};

/** A rebindable game / global hotkey on this code takes the plain press before the groups. */
const boundOutsidePossessed = (code: string, bindings: HotkeyBindings) =>
  HOTKEY_ACTIONS.some(action => HOTKEY_DEFAULTS[action].mode !== "possessed" && bindings[action] === code);

/**
 * The control-group matcher (military controls §8): Digit1–9 / Numpad1–9 with no modifier recalls, with
 * exactly Shift assigns. Ctrl / Alt / Meta + digit belong to the browser (tab switching) and never match.
 * The hotkey system rejects modifiers, so this fixed binding lives outside it (shown read-only in the panel).
 */
export const matchesGroupKey = (event: HotkeyEvent, bindings: HotkeyBindings): ArmyGroupKey | null => {
  const match = ARMY_GROUP_KEY_CODE.exec(event.code);
  if (!match || event.defaultPrevented || event.isComposing || event.repeat) return null;
  if (event.ctrlKey || event.altKey || event.metaKey || isEditable(event.target)) return null;
  const assign = Boolean(event.shiftKey);
  if (!assign && boundOutsidePossessed(event.code, bindings)) return null;
  return { assign, digit: Number(match[1]) };
};
