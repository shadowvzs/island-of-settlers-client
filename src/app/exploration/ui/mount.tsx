import { I18nProvider, useLingui } from "@lingui/react";
import { useMemo, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { ExplorationView } from "./exploration-view";
import type { ExplorationUiMountContext } from "./host";
import { selectExplorationOverlayView } from "./view-model";

const ExplorationMount = ({ actions, input, reducedMotion, store }: ExplorationUiMountContext) => {
  const { i18n } = useLingui();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const view = useMemo(() => selectExplorationOverlayView(snapshot, i18n), [i18n, snapshot]);
  if (!view) return null;
  return (
    <ExplorationView
      input={input}
      reducedMotion={reducedMotion}
      view={view}
      onLeave={actions.onLeave}
      onSpyglass={actions.onSpyglass}
      onSpyglassZoom={actions.onSpyglassZoom}
    />
  );
};

export const mountExplorationUi = (host: HTMLElement, context: ExplorationUiMountContext) => {
  const root = createRoot(host);
  if (context.i18n)
    root.render(<I18nProvider i18n={context.i18n}><ExplorationMount {...context} /></I18nProvider>);
  else root.render(<ExplorationMount {...context} />);
  return () => root.unmount();
};
