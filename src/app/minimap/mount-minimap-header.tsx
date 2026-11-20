import type { ExternalStore } from "../components/external-store";
import { mountReactIsland } from "../components/react-island";
import { MinimapHeader } from "./minimap-header";

/** Mounter for `createLazyReactContent`: the header content loads with React once the minimap is shown. */
export const createMinimapHeaderMount = (territory: ExternalStore<boolean>, showTerritory: boolean) =>
  (content: HTMLElement) =>
    mountReactIsland(content, <MinimapHeader showTerritory={showTerritory} territory={territory} />);
