import { mountReactIsland } from "../../components/react-island";
import type { EditorPanelControllers } from "../editor-panel";
import { EditorPanel } from "./editor-panel";

/** Mounter for `createLazyReactContent`: the editor panel loads with React on the editor's first open. */
export const createEditorPanelMount = (controllers: EditorPanelControllers) => (content: HTMLElement) =>
  mountReactIsland(content, <EditorPanel {...controllers} />);
