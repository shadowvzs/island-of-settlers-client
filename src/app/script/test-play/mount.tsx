import { createElement } from "react";

import { mountReactIsland } from "../../components/react-island";
import { TestPlayPanel, type TestPlayPanelProps } from "./test-play-panel";

/** Mounter of the play-test log panel: React and the view load only on a play-test page. */
export const mountTestPlayPanel = (root: HTMLElement, props: TestPlayPanelProps) =>
  mountReactIsland(root, createElement(TestPlayPanel, props));
