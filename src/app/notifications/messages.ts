import { msg } from "@lingui/core/macro";

export const NOTIFICATION_MESSAGES = {
  title: msg({ id: "notifications.settings.title", message: "Notifications" }),
  enabled: msg({ id: "notifications.settings.enabled", message: "Show important notifications" }),
  hint: msg({ id: "notifications.settings.hint", message: "Compact purchase confirmations, important events and actionable warnings. Routine updates stay silent." }),
  dismiss: msg({ id: "notifications.dismiss", message: "Dismiss notification" }),
  kinds: {
    error: msg({ id: "notifications.kind.error", message: "Error" }),
    warning: msg({ id: "notifications.kind.warning", message: "Warning" }),
    success: msg({ id: "notifications.kind.success", message: "Success" }),
    info: msg({ id: "notifications.kind.info", message: "Information" })
  }
};
