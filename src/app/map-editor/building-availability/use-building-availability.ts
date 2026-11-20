import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { useExternalStore } from "../../components/external-store";
import type { BuildingAvailabilityControls } from "./building-availability-controls";
import { type BuildingClickMode, buildingAvailabilityView } from "./view-model";

/**
 * The section's view model and callbacks; re-built only when the scenario copy, the click mode or the locale
 * change. The click mode (ban or max level) is a local draft of this view, never saved.
 */
export const useBuildingAvailability = (controls: BuildingAvailabilityControls) => {
  const { i18n } = useLingui();
  const state = useExternalStore(controls.state);
  const [mode, setMode] = useState<BuildingClickMode>("ban");
  const view = useMemo(() => buildingAvailabilityView(i18n, state, mode), [i18n, mode, state]);
  const onBuildingClick = mode === "ban" ? controls.toggleBan : controls.cycleLevelCap;
  return { ...view, onBuildingClick, onModeSelect: setMode, onTierSelect: controls.setTier };
};
