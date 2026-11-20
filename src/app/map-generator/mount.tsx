import { mountReactIsland } from "../components/react-island";
import { IslandForm } from "./island-form";
import { MapPanel } from "./map-panel";
import type { MapPanelOptions } from "./panel";
import type { IslandFormOptions } from "./use-island-form";

/** Mounter for `createLazyReactContent`: the Map generator panel. */
export const createMapPanelMount = (options: MapPanelOptions) => (content: HTMLElement) =>
  mountReactIsland(content, <MapPanel {...options} />);

/** The new island form alone (loading failure screen, review drivers); returns its unmount. */
export const mountIslandForm = (container: HTMLElement, { initial, onRecreate }: IslandFormOptions) =>
  mountReactIsland(container, <IslandForm initial={initial} onRecreate={onRecreate} />);
