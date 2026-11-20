import type { I18n } from "@lingui/core";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { translateMessage } from "../../../shared/i18n/translate";
import { createLazyReactWindow } from "../../components/lazy-react-window";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";
import { CUSTOMIZATION_MESSAGES } from "./messages";

/**
 * Main selection > Customization: nation avatar and male/female face radios. It joins the shared
 * window layer with the other lazy windows; React and the face art load on the first opening.
 */
export const createCustomizationWindow = (
  container: HTMLElement,
  setNation: (nation: WorkerNation) => Promise<void>,
  i18n?: I18n
) => createLazyReactWindow({
  className: "customization-window",
  container,
  contentClassName: "customization-window__body",
  heading: () => translateMessage(i18n, M.window.customization),
  i18n,
  id: "settings-customization-title",
  load: async () => (await import("./mount-customization-panel")).createCustomizationMount({ setNation }),
  texts: {
    error: () => translateMessage(i18n, CUSTOMIZATION_MESSAGES.window.loadFailed),
    loading: () => translateMessage(i18n, CUSTOMIZATION_MESSAGES.window.loading)
  }
});
