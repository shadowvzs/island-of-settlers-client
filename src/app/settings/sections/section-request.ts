import type { SettingsSection } from "../../../../../island-of-settlers-shared/src/script/types/ui";
import { createExternalStore } from "../../components/ui-store";
import type { TabRequest } from "../../components/use-tabs";
import { SETTINGS_SECTION_TABS } from "./constants";

/** Which Settings tab the next script opening shows; each request has a new revision. */
export const createSettingsSectionRequest = () => {
  const store = createExternalStore<TabRequest | null>(null);
  return {
    request: (section: SettingsSection) =>
      store.set({ id: SETTINGS_SECTION_TABS[section], revision: (store.getSnapshot()?.revision ?? 0) + 1 }),
    store
  };
};

export type SettingsSectionRequest = ReturnType<typeof createSettingsSectionRequest>;
