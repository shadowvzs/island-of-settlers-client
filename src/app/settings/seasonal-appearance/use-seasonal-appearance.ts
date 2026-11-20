import { useLingui } from "@lingui/react";

import { useExternalStore } from "../../components/external-store";
import { SEASONAL_APPEARANCE_MESSAGES as M } from "./messages";
import { seasonalAppearance } from "./store";

/** Every player's per-browser opt-out of the global cosmetic season. */
export const useSeasonalAppearance = () => {
  const { i18n } = useLingui();
  const snapshot = useExternalStore(seasonalAppearance);
  const toggle = () =>
    seasonalAppearance.setIgnoreGlobalWinter(!seasonalAppearance.getSnapshot().ignoreGlobalWinter);
  const title = i18n._(snapshot.ignoreGlobalWinter ? M.ignoreYes : M.ignoreNo);
  return { disabled: false, hint: i18n._(M.ignoreHint), label: i18n._(M.ignore), pressed: snapshot.ignoreGlobalWinter,
    sectionTitle: i18n._(M.title), status: title, title, onToggle: toggle };
};
