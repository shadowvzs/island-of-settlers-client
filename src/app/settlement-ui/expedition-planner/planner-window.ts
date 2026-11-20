import { translateMessage } from "../../../shared/i18n/translate";
import { createExternalStore } from "../../components/ui-store";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import type { PlannerKind } from "./helpers";

import "../colony.css";

const PLANNERS = {
  adventure: { heading: M.planner.titleAdventure, id: "settlement-adventure-planner-title",
    islandLabel: M.planner.islandAdventure },
  colony: { heading: M.planner.titleColony, id: "settlement-colony-planner-title",
    islandLabel: M.planner.islandColony }
} as const;

/**
 * Harbour expedition planner window (`openFor(harbour)`): React content on the shared frame, reading the
 * settlement store while shown. Colony: island, troops, supplies and crew; adventure: island and troops.
 */
const createExpeditionPlannerWindow = (kind: PlannerKind, store: SettlementUiStore, options: SettlementUiOptions) => {
  const { heading, id, islandLabel } = PLANNERS[kind];
  const translatedIslandLabel = translateMessage(options.i18n, islandLabel);
  const harbour = createExternalStore(0);
  const frame = createReactSettlementWindow({
    className: "settlement-ui__colony-planner-window",
    contentClassName: "settlement-ui__overview colony-planner",
    heading: translateMessage(options.i18n, heading),
    id,
    load: async (visibility, close) => (await import("./mount")).createExpeditionPlannerMount(
      { close, harbour, kind, options, store, visibility }, translatedIslandLabel)
  });
  return {
    ...frame,
    openFor: (uid: number) => {
      harbour.set(uid);
      frame.open();
    }
  };
};

export const createColonyPlannerWindow = (store: SettlementUiStore, options: SettlementUiOptions) =>
  createExpeditionPlannerWindow("colony", store, options);

export const createAdventurePlannerWindow = (store: SettlementUiStore, options: SettlementUiOptions) =>
  createExpeditionPlannerWindow("adventure", store, options);
