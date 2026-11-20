import {
  DEFAULT_ONLINE_SETTINGS, type GameSettings
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { createExternalStore } from "../../components/ui-store";
import type { BootGameSettings, GameSettingsOrigin } from "../../game-settings/settings-source";

/**
 * The game settings the map and campaign editors read their mode from (owner Q2, 2026-11-12; plan §13.4): the GS0
 * model with the local default (home-island mode) until the deployment's settings are published here by the
 * settings source (GS3a; ADMIN-UI republishes after a save).
 */
export const editorGameSettings = createExternalStore<GameSettings>(DEFAULT_ONLINE_SETTINGS);

/** Where the editors' settings came from; `pending` until the settings source answered ("Mode not loaded"). */
export type EditorSettingsStatus = GameSettingsOrigin | "pending";
export const editorSettingsStatus = createExternalStore<EditorSettingsStatus>("pending");

/** Publishes the settings source's answer; `none` keeps the default (no deployment settings: today's game). */
export const publishEditorGameSettings = ({ origin, settings }: BootGameSettings) => {
  if (settings) editorGameSettings.set(settings);
  editorSettingsStatus.set(origin);
};
