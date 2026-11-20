import { translateMessage } from "../../../shared/i18n/translate";
import { createLazyReactWindow } from "../../components/lazy-react-window";
import { readScriptDeepLink } from "./deep-link";
import { SCRIPT_MESSAGES as M } from "./messages";
import { createScriptWorkspace, type ScriptWorkspaceOptions } from "./script-workspace";

/**
 * The Script workspace window (design §13.1): the shared movable window frame in the editor's window layer, its
 * React content loaded on the first open (admin-only like the whole editor page). During "pick on map" the window
 * steps aside (hidden, no pointer events) so the click reaches the map, and comes back afterwards.
 */
export const createScriptWindow = (container: HTMLElement, options: ScriptWorkspaceOptions) => {
  const { i18n } = options;
  const workspace = createScriptWorkspace(options);
  const window = createLazyReactWindow({
    className: "script-workspace-window", container, contentClassName: "script-workspace-window__body", i18n,
    heading: () => translateMessage(i18n, M.workspace.title), id: "script-workspace-title",
    load: async () => (await import("./mount-script-workspace")).createScriptWorkspaceMount(workspace)
  });
  const stopPickWatch = workspace.subscribe(() => {
    window.root.classList.toggle("is-picking", workspace.getSnapshot().pick !== null);
  });
  return {
    close: window.close,
    dispose: () => {
      stopPickWatch();
      window.dispose();
    },
    open: () => {
      workspace.refresh();
      window.open();
    },
    registerOpener: window.registerOpener,
    workspace
  };
};

export type ScriptWindow = ReturnType<typeof createScriptWindow>;

/** Opens the window on the page URL's deep link (`?script=<tab>&scriptItem=<id>`), when there is one. */
export const openScriptDeepLink = (window: ScriptWindow, search = globalThis.location?.search ?? "") => {
  const link = readScriptDeepLink(search);
  if (!link) return;
  window.workspace.focusItem(link);
  window.open();
};
