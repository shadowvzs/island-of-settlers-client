import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";

import { mountNotificationHost } from "../../src/app/notifications/host";
import { notificationPreferences } from "../../src/app/notifications/preferences";
import { notifications } from "../../src/app/notifications/service";
import { NotificationSettings } from "../../src/app/notifications/settings-section";
import { getStyleOptions } from "../../src/app/settings/theme/helpers";
import { messages } from "../../src/locales/en/messages";

import "../../src/app/hud-paper.css";

export const mountNotificationReview = () => {
  const i18n = setupI18n({ locale: "en", messages: { en: messages } });
  const dispose = mountNotificationHost(i18n), panel = document.createElement("div");
  panel.style.cssText = "margin:24px;width:330px;padding:16px;background:#eedfbc;color:#302b24";
  document.body.append(panel);
  const root = createRoot(panel); root.render(<I18nProvider i18n={i18n}><NotificationSettings /></I18nProvider>);
  notificationPreferences.setEnabled(true);
  return { notifications, themeStyles: getStyleOptions("current").map(option => option.value),
    dispose: () => { root.unmount(); panel.remove(); dispose(); } };
};
