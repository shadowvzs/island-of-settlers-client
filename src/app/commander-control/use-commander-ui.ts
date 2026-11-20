import { useLingui } from "@lingui/react";

import { actorActionEnabled } from "../../render-common/workers/actor-action-capabilities";
import { useExternalStore } from "../components/external-store";
import type { createExternalStore } from "../components/ui-store";
import { selectExplorationOverlayView } from "../exploration/ui/view-model";
import { COMMANDER_HOTKEY_ACTIONS, formatHotkeyCode, hotkeySettings } from "../settings/hotkeys/bindings";
import { HOTKEY_MESSAGES } from "../settings/hotkeys/messages";
import type { CommanderUiState } from "./ui";
import { COMMANDER_UI_MESSAGES } from "./ui-messages";

export const useCommanderUi = (store: ReturnType<typeof createExternalStore<CommanderUiState>>) => {
  const { i18n } = useLingui(), state = useExternalStore(store), bindings = useExternalStore(hotkeySettings);
  const view = selectExplorationOverlayView({ actorType: "commander", canEnter: state.canEnter,
    cooldownInMs: 0, eligibility: { eligible: true }, leaveUnlockInMs: 0, progress: 1,
    phase: state.phase === "active" ? "possessed" : "idle", spyglass: false, notice: state.notice }, i18n);
  const rows = COMMANDER_HOTKEY_ACTIONS.filter(action => actorActionEnabled("commander", action)).map(action => ({
    action, key: formatHotkeyCode(bindings[action]), label: i18n._(HOTKEY_MESSAGES.actions[action])
  }));
  const health = i18n._({ ...COMMANDER_UI_MESSAGES.health,
    values: { hp: Math.ceil(state.hp), maximum: Math.ceil(state.maximum) } });
  const fraction = Math.max(0, Math.min(1, state.hp / Math.max(1, state.maximum)));
  return { state, view, rows, health, healthWidth: `${fraction * 100}%`,
    enterLabel: i18n._(COMMANDER_UI_MESSAGES.enter), preparingLabel: i18n._(COMMANDER_UI_MESSAGES.preparing),
    backLabel: i18n._(HOTKEY_MESSAGES.actions.back) };
};
