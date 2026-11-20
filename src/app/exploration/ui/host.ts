import type { I18n } from "@lingui/core";

import type { ReadableStore } from "../../components/ui-store";
import { getWindowLayer } from "../../window-layer";
import type { ExplorationUiSnapshot } from "../contracts";
import type { ExplorationInput } from "../input/controller";

export interface ExplorationUiMountActions {
  onLeave: () => void;
  onSpyglass: () => void;
  onSpyglassZoom?: (direction: 1 | -1) => void;
}

export interface ExplorationUiMountContext {
  actions: ExplorationUiMountActions;
  i18n?: I18n;
  input: ExplorationInput | null;
  reducedMotion?: boolean;
  store: ReadableStore<ExplorationUiSnapshot>;
}

export interface ExplorationUiHost {
  mount: (context: ExplorationUiMountContext) => () => void;
}

/**
 * Lazily loads the React overlay into the window layer. The entry button lives in the player corner;
 * this host only renders while an exploration session or its refusal notice is visible.
 */
export const createDefaultExplorationUiHost = (mount?: HTMLElement): ExplorationUiHost => {
  let disposed = false;
  let mounted = false;
  let unmount: (() => void) | undefined;
  const documentContext = typeof document === "undefined" ? null : document;
  const viewport = documentContext?.querySelector<HTMLElement>("#viewport") ?? documentContext?.body;
  /** Never mount inside `.settlement-ui`: the exploration HUD scope hides that root while active. */
  const target = mount?.closest(".settlement-ui") ? viewport : mount ?? viewport;
  if (!target) return { mount: () => () => undefined };
  return {
    mount: (context) => {
      if (!target || mounted) return () => undefined;
      mounted = true;
      // The window layer also owns the settlement HUD and other windows. A React root mounted
      // directly into it clears those siblings; give this overlay its own child host.
      const element = document.createElement("div");
      element.className = "exploration-ui-host";
      getWindowLayer(target).append(element);
      void import("./mount")
        .then(({ mountExplorationUi }) => {
          if (!disposed) unmount = mountExplorationUi(element, context);
          return undefined;
        })
        .catch(error => console.error("Exploration HUD could not load", error));
      return () => {
        disposed = true;
        unmount?.();
        unmount = undefined;
        element.remove();
      };
    }
  };
};
