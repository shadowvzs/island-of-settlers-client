import { createComponentMount } from "../../components/react-island";
import { ColonyTracker } from "./colony-tracker-view";
import type { ColonyTrackerContext } from "./use-colony-tracker";

/** Mounter for `createLazyReactContent`: the tracker body loads with React on the first expedition. */
export const createColonyTrackerMount = (context: ColonyTrackerContext) => createComponentMount(ColonyTracker, { context });
