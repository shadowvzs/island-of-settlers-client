import { useExternalStore } from "../../components/external-store";
import type { MainPanelView, MainPanelVisibilityStore } from "./main-panel";

/** True while the main panel is shown on this view; hidden views keep their last selection. */
export const useMainPanelView = (panel: MainPanelVisibilityStore, view: MainPanelView) => {
  const { view: shown, visible } = useExternalStore(panel);
  return visible && shown === view;
};
