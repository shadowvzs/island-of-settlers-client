import { useSetting } from "../../components/use-setting";
import type { MilitaryAiDebug } from "../military-ai-debug";

/** Military AI debug controls: the mode is fixed; the overlay is the only remaining control. */
export const useMilitaryAiDebug = (debug: MilitaryAiDebug) => {
  const [overlay, setOverlay] = useSetting<boolean>(false, debug.setOverlayVisible);
  return {
    overlay,
    onOverlayChange: setOverlay
  };
};
