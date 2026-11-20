import type { I18n } from "@lingui/core";
import { I18nProvider, useLingui } from "@lingui/react";
import { createRoot } from "react-dom/client";

import errorIcon from "../../../assets/ui-icons/notifications/error.png";
import infoIcon from "../../../assets/ui-icons/notifications/info.png";
import successIcon from "../../../assets/ui-icons/notifications/success.png";
import warningIcon from "../../../assets/ui-icons/notifications/warning.png";
import { useExternalStore } from "../components/external-store";
import { isolatePointer } from "../window-layer";
import { NOTIFICATION_MESSAGES as M } from "./messages";
import { notifications, type ToastMessage } from "./service";

import "./notifications.css";

const ICONS = { error: errorIcon, warning: warningIcon, success: successIcon, info: infoIcon };
const toastClass = (toast: ToastMessage) => {
  let result = `app-toast app-toast--${toast.kind}`;
  if (toast.exiting) result += " is-exiting";
  return result;
};
const toastRole = (toast: ToastMessage) => {
  if (toast.kind === "error") return "alert";
  return "status";
};

const NotificationList = () => {
  const { i18n } = useLingui(), messages = useExternalStore(notifications);
  return <>
    {messages.map(toast => <div aria-label={i18n._(M.kinds[toast.kind])} className={toastClass(toast)}
      data-toast-kind={toast.kind} key={toast.id} role={toastRole(toast)}>
      <img alt="" draggable={false} height={28} src={ICONS[toast.kind]} width={28} />
      <span className="app-toast__message">{toast.message}</span>
      {toast.count > 1 && <small className="app-toast__count">×{toast.count}</small>}
      <button aria-label={i18n._(M.dismiss)} title={i18n._(M.dismiss)} type="button"
        onClick={() => notifications.dismiss(toast.id)}>×</button>
    </div>)}
  </>;
};

let mounted: { dispose: () => void } | undefined;
/** One document-level foreground owner, retained across island replacements. */
export const mountNotificationHost = (i18n: I18n) => {
  if (mounted) return () => undefined;
  const host = document.createElement("div"); host.className = "app-notification-host";
  host.dataset.notifications = "true"; document.body.append(host); isolatePointer(host);
  const root = createRoot(host);
  root.render(<I18nProvider i18n={i18n}><NotificationList /></I18nProvider>);
  const owner = { dispose: () => {
    if (mounted !== owner) return;
    root.unmount(); host.remove(); notifications.clear(); mounted = undefined;
  } };
  mounted = owner; return owner.dispose;
};
