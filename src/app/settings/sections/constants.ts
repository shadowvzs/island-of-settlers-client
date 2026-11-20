import type { SettingsSection } from "../../../../../island-of-settlers-shared/src/script/types/ui";

/** The Settings tab that holds each section a map script may open (script `openUi settings`, TRG9). */
export const SETTINGS_SECTION_TABS: Readonly<Record<SettingsSection, string>> = Object.freeze({
  dayMode: "misc", dialogueSpeed: "misc", graphics: "graphics", sound: "sounds", weather: "misc", world: "misc"
});
