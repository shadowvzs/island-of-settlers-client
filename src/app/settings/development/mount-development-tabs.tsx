import { mountReactIsland } from "../../components/react-island";
import type { DevelopmentTabContent } from "./development-tabs";
import { DevelopmentTabs } from "./development-tabs-panel";

/** Mounter for `createLazyReactContent`: the development tabs load with React on the panel's first open. */
export const createDevelopmentTabsMount = (tabs: readonly DevelopmentTabContent[]) => (content: HTMLElement) =>
  mountReactIsland(content, <DevelopmentTabs tabs={tabs} />);
