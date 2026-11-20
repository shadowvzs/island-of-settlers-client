import { createExternalStore } from "../components/ui-store";
import { rawTextCodec } from "../preferences/codecs";
import { PREFERENCES } from "../preferences/keys";
import { definePreference } from "../preferences/registry";

const notificationsPreference = definePreference(PREFERENCES.notifications, rawTextCodec);
export const createNotificationPreferences = (stored: string | null, persist: (value: string) => void) => {
  const store = createExternalStore(stored !== "disabled");
  return { ...store, setEnabled: (enabled: boolean) => {
    if (enabled === store.getSnapshot()) return;
    persist(enabled ? "enabled" : "disabled"); store.set(enabled);
  } };
};
export const notificationPreferences = createNotificationPreferences(
  notificationsPreference.read(), value => { notificationsPreference.write(value); }
);
