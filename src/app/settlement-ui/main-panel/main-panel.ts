import { createExternalStore, type ExternalStore } from "../../components/ui-store";

/** The main panel's exclusive internal views. */
export type MainPanelView = "build" | "menu" | "notices" | "ships";

/** The shown view, whether the panel is visible and how many times it was opened (focus on open). */
export interface MainPanelVisibility {
  opened: number;
  view: MainPanelView;
  visible: boolean;
}

export type MainPanelVisibilityStore = ExternalStore<MainPanelVisibility>;

interface MainPanelOptions {
  isBuildBlocked: () => boolean;
}

/**
 * The movable main window (Build, Main selection, Fleet, Notifications): this React-free owner keeps which view
 * shows and whether the panel is visible; the HUD's React root renders the frame and its views. Opening the
 * shown view again closes it.
 */
export const createMainPanel = ({ isBuildBlocked }: MainPanelOptions) => {
  const visibility = createExternalStore<MainPanelVisibility>({ opened: 0, view: "build", visible: false });
  const hide = () => {
    const current = visibility.getSnapshot();
    if (current.visible) visibility.set({ ...current, visible: false });
  };
  const isShowing = (view: MainPanelView) => {
    const current = visibility.getSnapshot();
    return current.visible && current.view === view;
  };
  const open = (view: MainPanelView) => {
    if (view === "build" && isBuildBlocked()) return;
    if (isShowing(view)) {
      hide();
      return;
    }
    visibility.set({ opened: visibility.getSnapshot().opened + 1, view, visible: true });
  };
  /** Shows the view and raises the panel; never toggles it closed (script `openUi`, design §5.2.9). */
  const focusView = (view: MainPanelView) => {
    if (view === "build" && isBuildBlocked()) return false;
    visibility.set({ opened: visibility.getSnapshot().opened + 1, view, visible: true });
    return true;
  };
  return { focusView, hide, isShowing, open, visibility };
};
