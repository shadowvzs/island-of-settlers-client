import { useLingui } from "@lingui/react";
import { useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { CatalogVersionWarning } from "./helpers";
import { CATALOG_VERSION_MESSAGES as M } from "./messages";

/** The warning panel's texts while it is shown; null once dismissed or when there is nothing to warn about. */
export const useCatalogVersionWarning = (warning: CatalogVersionWarning | null) => {
  const { i18n } = useLingui();
  const [dismissed, setDismissed] = useState(false);
  if (!warning || dismissed) return null;
  return {
    body: translateMessage(i18n, M.body, { gameVersion: warning.gameVersion, mapVersion: warning.mapVersion }),
    dismiss: translateMessage(i18n, M.dismiss),
    title: translateMessage(i18n, M.title),
    onDismiss: () => setDismissed(true)
  };
};
