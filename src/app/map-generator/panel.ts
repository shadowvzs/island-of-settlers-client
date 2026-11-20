import type { I18n } from "@lingui/core";

import { createLazyReactContent } from "../components/lazy-react-content";
import { createExternalStore, type ExternalStore } from "../components/ui-store";
import { getInitialIslandChoice, reloadWithNewIsland } from "./actions";
import type { CurrentIsland } from "./current-island-helpers";
import type { IslandChoice } from "./helpers";

export { type CurrentIsland,describeCurrentIsland } from "./current-island-helpers";

/** What the map generator panel renders. */
export interface MapPanelOptions {
  /** Optional translator owner; absent keeps the English source strings (tests/helpers). */
  i18n?: I18n;
  initial: IslandChoice;
  island: CurrentIsland;
  /** Milliseconds the island took to load; undefined until loading finished. */
  loadTime: ExternalStore<number | undefined>;
  onRecreate: (choice: IslandChoice, seed?: number) => void;
}

/** The Map generator corner panel's content element, its first-open mount and the load time setter. */
export interface MapPanelContent {
  content: HTMLElement;
  dispose: () => void;
  mount: () => void;
  setLoadTime: (milliseconds: number) => void;
}

/**
 * Map panel content: the current island (seed, size, landform, theme, options, load time) and the form
 * that generates a new island. React and the form load on the panel's first open.
 */
export const createMapPanelContent = (
  island: CurrentIsland,
  i18n?: I18n,
  onRecreate: MapPanelOptions["onRecreate"] = reloadWithNewIsland
): MapPanelContent => {
  const content = document.createElement("div");
  const loadTime = createExternalStore<number | undefined>(undefined);
  const lazyContent = createLazyReactContent(content, "Map generator", async () =>
    (await import("./mount")).createMapPanelMount({
      i18n, initial: getInitialIslandChoice(), island, loadTime, onRecreate
    }));
  return {
    content,
    dispose: lazyContent.dispose,
    mount: lazyContent.mount,
    setLoadTime: loadTime.set
  };
};
