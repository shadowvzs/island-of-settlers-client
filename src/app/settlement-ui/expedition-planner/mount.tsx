import { createComponentMount } from "../../components/react-island";
import { ExpeditionPlanner } from "./expedition-planner";
import type { ExpeditionPlannerContext } from "./use-expedition-planner";

/** Mounter for `createLazyReactContent`: the planner loads with React on its first open. */
export const createExpeditionPlannerMount = (context: ExpeditionPlannerContext, islandLabel: string) =>
  createComponentMount(ExpeditionPlanner, { context, islandLabel });
