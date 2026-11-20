import { mountReactIsland } from "../../components/react-island";
import type { ScriptWorkspace } from "./script-workspace";
import { ScriptWorkspaceView } from "./script-workspace-view";

import "../../settlement-ui/styles.css";

/** Mounter for the lazy window: the Script workspace loads with its window's first open. */
export const createScriptWorkspaceMount = (workspace: ScriptWorkspace) => (content: HTMLElement) =>
  mountReactIsland(content, <ScriptWorkspaceView workspace={workspace} />);
