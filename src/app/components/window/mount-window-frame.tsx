import { mountReactIsland } from "../react-island";
import { StoredWindowFrame } from "./stored-window-frame";
import type { MountWindowFrame } from "./window-frame-controller";

/** The shared frame around DOM content (loaded with React on a window's first open). */
export const mountWindowFrame: MountWindowFrame = (host, props) =>
  mountReactIsland(host, <StoredWindowFrame {...props} />);
