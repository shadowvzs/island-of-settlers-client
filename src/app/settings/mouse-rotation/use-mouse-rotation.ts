import { useExternalStore } from "../../components/external-store";
import { mouseRotationPreference } from "./preference";

/** The chosen mouse rotation button and its setter (Settings > Hotkeys). */
export const useMouseRotation = () => ({
  onRotationChange: mouseRotationPreference.setRotation,
  rotation: useExternalStore(mouseRotationPreference)
});
