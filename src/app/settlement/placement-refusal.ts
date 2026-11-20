import type { I18n } from "@lingui/core";

import { translateDomainText } from "../../shared/i18n/domain";
import { notifications } from "../notifications/service";

type RefusalToast = Pick<typeof notifications, "warning">;

/**
 * The placement badge's refusal in the active locale. The badge is redrawn every preview frame while the
 * verdict rarely changes, so the last English reason and its translation are kept (pattern lookups stay off
 * the pointer path).
 */
export const createPlacementReasonText = (i18n?: I18n) => {
  let source = "", locale: string | undefined, text = "";
  return (reason: string) => {
    if (reason === source && i18n?.locale === locale) return text;
    source = reason; locale = i18n?.locale;
    text = translateDomainText(reason, i18n);
    return text;
  };
};

/** NEW-ISLAND-FEEDBACK: a refused building placement is told on screen, never only in the notice history. */
export const announcePlacementRefusal = (reason: string, i18n?: I18n, toast: RefusalToast = notifications) =>
  toast.warning(translateDomainText(reason, i18n), { dedupeKey: `placement:${reason}`, important: true });
