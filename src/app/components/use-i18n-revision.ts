import type { I18n } from "@lingui/core";
import { useEffect, useReducer } from "react";

/** Re-renders a view when its Lingui instance activates another locale. */
export const useI18nRevision = (i18n?: I18n) => {
  const [, rerender] = useReducer((revision: number) => revision + 1, 0);
  useEffect(() => i18n?.on("change", rerender), [i18n]);
};
