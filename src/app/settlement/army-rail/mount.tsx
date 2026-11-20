import { mountReactIsland } from "../../components/react-island";
import type { ExternalStore } from "../../components/ui-store";
import type { ArmyRailActions } from "../army-action-rail";
import { ArmyRailContent } from "./army-rail-view";
import type { ArmyRailState } from "./helpers";

/** Mounter for `createLazyReactContent`: the rail view loads with React once the game is idle. */
export const createArmyRailMount = (store: ExternalStore<ArmyRailState>, actions: ArmyRailActions) =>
  (content: HTMLElement) => mountReactIsland(content, <ArmyRailContent actions={actions} store={store} />);
