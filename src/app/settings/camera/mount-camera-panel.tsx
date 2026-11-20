import { mountReactIsland } from "../../components/react-island";
import { CameraPanel, type CameraPanelProps } from "./camera-panel-view";

/** Mounter for `createLazyReactContent`: the camera panel content loads with React on the panel's first open. */
export const createCameraPanelMount = (props: CameraPanelProps) => (content: HTMLElement) =>
  mountReactIsland(content, <CameraPanel {...props} />);
