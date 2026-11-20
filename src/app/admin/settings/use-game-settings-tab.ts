import { useLingui } from "@lingui/react";

import type {
  GameSettings, GameSettingsPresetId, TitleScreenFiles
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { translateMessage } from "../../../shared/i18n/translate";
import type { AdminPorts, RevisionInfo, SettingsSnapshot } from "../admin-ports";
import { SHORT_ID_LENGTH } from "../constants";
import { ADMIN_MESSAGES as M } from "../messages";
import {
  type BooleanSettingKey, type RewardsChoice, sameSettings, withAfterMap, withAutosaveMinutes, withConnectivity,
  withLevels, withPreset, withRewards, withSwitch, withTitleFile
} from "./helpers";
import { type PendingConfirmation, useGameSettingsForm } from "./use-game-settings-form";
import { settingsViewModel } from "./view-model";

type Translate = ReturnType<typeof useLingui>["i18n"];

const revisionLine = (i18n: Translate, latest: RevisionInfo | null, base: SettingsSnapshot | null) => {
  if (!latest) return translateMessage(i18n, M.footer.local);
  if (!latest.createdAt) return translateMessage(i18n, M.footer.defaultRevision);
  return translateMessage(i18n, M.footer.changed, {
    author: latest.createdBy?.slice(0, SHORT_ID_LENGTH) ?? "—",
    revision: (base?.revision ?? latest.revision).slice(0, SHORT_ID_LENGTH),
    time: new Date(latest.createdAt).toLocaleString()
  });
};

/** Edit callbacks over the draft; each builds the next document with a pure helper. */
const draftEditors = (draft: GameSettings, edit: (next: GameSettings) => void, keepConnectivity: boolean) => ({
  onAfterMap: (value: GameSettings["afterMap"]) => edit(withAfterMap(draft, value)),
  onAutosaveMinutes: (minutes: number) => edit(withAutosaveMinutes(draft, minutes)),
  onConnectivity: (value: GameSettings["connectivity"]) => edit(withConnectivity(draft, value)),
  onFixedLevel: (level: number) => edit(withLevels(draft, "fixed", level)),
  onLevels: (kind: "earned" | "fixed") => edit(withLevels(draft, kind)),
  onPreset: (presetId: GameSettingsPresetId) => edit(withPreset(draft, presetId, keepConnectivity)),
  onRewards: (choice: RewardsChoice) => edit(withRewards(draft, choice)),
  onSwitch: (key: BooleanSettingKey, value: boolean) => edit(withSwitch(draft, key, value)),
  onTitleFile: (field: keyof TitleScreenFiles, value: string) => edit(withTitleFile(draft, field, value))
});

export type DraftEditors = ReturnType<typeof draftEditors>;

/** The confirmation dialog's texts; null while no confirmation is open. */
const confirmationView = (i18n: Translate, confirmation: PendingConfirmation | null) => {
  if (!confirmation) return null;
  const count = confirmation.mapWarnings ?? 0;
  return {
    cancelLabel: translateMessage(i18n, M.confirm.cancel),
    intro: translateMessage(i18n, M.confirm.intro),
    lines: confirmation.lines,
    mapWarnings: count > 0 ? translateMessage(i18n, M.confirm.mapWarnings, { count }) : "",
    saveLabel: translateMessage(i18n, M.confirm.save),
    title: translateMessage(i18n, M.confirm.title)
  };
};

export type ConfirmationView = NonNullable<ReturnType<typeof confirmationView>>;

/** The Game settings tab: the form, its prepared view and the footer/dialog texts. */
export const useGameSettingsTab = (ports: AdminPorts) => {
  const { i18n } = useLingui();
  const form = useGameSettingsForm(ports);
  const store = ports.settings.store;
  const { base, draft } = form;
  const dirty = Boolean(base && draft && !sameSettings(base.settings, draft));
  const view = draft && settingsViewModel(i18n, draft, store);
  return {
    ...form,
    canSave: dirty && !form.busy && !view?.issues.blocking,
    confirmationView: confirmationView(i18n, form.confirmation),
    dirty,
    editors: draft && draftEditors(draft, form.edit, store === "server"),
    errorText: translateMessage(i18n, M.window.loadFailed, { error: form.error }),
    footer: {
      applies: translateMessage(i18n, M.footer.applies),
      reloadLabel: translateMessage(i18n, M.footer.reload),
      revision: revisionLine(i18n, form.latest, base),
      saveLabel: translateMessage(i18n, M.footer.save),
      savedText: translateMessage(i18n, M.footer.saved),
      unsavedText: translateMessage(i18n, M.footer.unsaved)
    },
    view
  };
};

export type GameSettingsTabState = ReturnType<typeof useGameSettingsTab>;
