import { useExternalStore } from "../../components/external-store";
import { hasHoverPointer, systemCursorPreference } from "../../cursors/cursor-preference";

/** Settings > Misc "System cursor": the choice, its setter and whether this device shows a cursor at all. */
export const useSystemCursor = () => ({
  enabled: useExternalStore(systemCursorPreference),
  onEnabledChange: systemCursorPreference.setEnabled,
  visible: hasHoverPointer()
});
