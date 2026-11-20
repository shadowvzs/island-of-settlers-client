import type { BackendConfig } from "../backend/backend-config";
import { publishEditorGameSettings } from "../map-editor/map-rules/editor-game-settings";
import { openGameDatabase } from "../settlement/game-database";
import { BUNDLED_SETTINGS_FILE } from "./constants";
import { type BootGameSettings, browserSettingsSource, resolveBootGameSettings } from "./settings-source";

const TOOL_RUN_SETTINGS: BootGameSettings = Object.freeze({ origin: "none", settings: null });

/**
 * Boot step 1b (plan §7.2, GS3a): the deployment's settings before sign-in. Tool runs read none (no request, legacy
 * rules, byte-identical to today). The answer is published to the editors' mode store.
 */
export const loadBootGameSettings = async (
  { backend, toolRun }: { backend: BackendConfig | null; toolRun: boolean }
): Promise<BootGameSettings> => {
  if (toolRun) return TOOL_RUN_SETTINGS;
  const boot = await resolveBootGameSettings(browserSettingsSource({
    backend, bundledUrl: `${import.meta.env.BASE_URL}${BUNDLED_SETTINGS_FILE}`, database: await openGameDatabase()
  }));
  publishEditorGameSettings(boot);
  return boot;
};

/**
 * The editor page's settings (plan §13.4, MODE-EDITOR): the same source as the game's boot, published to the
 * editors' mode store. A failed read (blocked storage) publishes "none", so the editors keep the default mode.
 */
export const loadEditorGameSettings = async (backend: BackendConfig | null): Promise<void> => {
  try {
    await loadBootGameSettings({ backend, toolRun: false });
  } catch (error) {
    console.warn("[game-settings] the editor keeps the default mode:", error);
    publishEditorGameSettings(TOOL_RUN_SETTINGS);
  }
};
