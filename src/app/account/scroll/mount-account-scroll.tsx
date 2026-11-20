import { mountReactIsland } from "../../components/react-island";
import type { ExternalStore } from "../../components/ui-store";
import { AccountScrollView } from "./account-scroll-view";
import type { ShownScrollPage } from "./scroll-pages";

/** Mounts the scroll's React view into its overlay (loaded with React when the scroll is first shown). */
export const mountAccountScrollView = (overlay: HTMLElement, pages: ExternalStore<ShownScrollPage | null>) =>
  mountReactIsland(overlay, <AccountScrollView pages={pages} />);
