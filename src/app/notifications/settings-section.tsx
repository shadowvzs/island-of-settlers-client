import { useLingui } from "@lingui/react";

import { Checkbox } from "../components/checkbox";
import { useExternalStore } from "../components/external-store";
import { Section } from "../components/section";
import { NOTIFICATION_MESSAGES as M } from "./messages";
import { notificationPreferences } from "./preferences";

export const NotificationSettings = () => {
  const { i18n } = useLingui(), enabled = useExternalStore(notificationPreferences);
  return <Section icon="message" title={i18n._(M.title)}>
    <Checkbox checked={enabled} label={i18n._(M.enabled)} title={i18n._(M.hint)}
      onChange={notificationPreferences.setEnabled} />
  </Section>;
};
