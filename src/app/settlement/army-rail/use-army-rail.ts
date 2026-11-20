import { useLingui } from "@lingui/react";
import { type KeyboardEvent, useRef } from "react";

import { useExternalStore } from "../../components/external-store";
import type { ExternalStore } from "../../components/ui-store";
import { formatHotkeyCode, type HotkeyBindings, hotkeySettings } from "../../settings/hotkeys/bindings";
import { hotkeyHintVisibility } from "../../settings/hotkeys/hint-visibility";
import type { ArmyRailActions } from "../army-action-rail";
import { type ArmyAction, type ArmyRailHotkeys, type ArmyRailState, getArmyRailView } from "./helpers";

/** The rebindable hotkey of each order button (military controls §5.2). */
const ACTION_HOTKEYS = {
  attack: "armyAttackMove", enter: "armyEnter", move: "armyMove", retreat: "armyRetreat", return: "armyReturn"
} as const satisfies Record<ArmyAction, keyof HotkeyBindings>;

/** The rail tooltips' key texts (§11); none while the player hides the hotkey hints. */
const getRailHotkeys = (bindings: HotkeyBindings, visible: boolean): ArmyRailHotkeys => {
  if (!visible) return {};
  const entries = Object.entries(ACTION_HOTKEYS).filter(([, hotkey]) => bindings[hotkey])
    .map(([action, hotkey]) => [action, formatHotkeyCode(bindings[hotkey])]);
  return Object.fromEntries(entries) as ArmyRailHotkeys;
};

/**
 * The rail's prepared view plus the troop panel's Escape: it stops there (the window listener would also
 * clear the order and selection), closes the panel and returns focus to "Select troops".
 */
export const useArmyRail = (store: ExternalStore<ArmyRailState>, actions: ArmyRailActions) => {
  const { i18n } = useLingui();
  const state = useExternalStore(store);
  const bindings = useExternalStore(hotkeySettings);
  const hintsVisible = useExternalStore(hotkeyHintVisibility);
  // Cheap to prepare, and not memoized: the Lingui instance stays the same object when the language changes.
  const view = getArmyRailView(state, { hotkeys: getRailHotkeys(bindings, hintsVisible), i18n });
  const rallyButton = useRef<HTMLButtonElement>(null);
  const onRallyKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    actions.closeRally();
    rallyButton.current?.focus();
  };
  return { onRallyKeyDown, rallyButton, view };
};
