import { useLingui } from "@lingui/react";
import { useSyncExternalStore } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { ReadableStore } from "../../components/ui-store";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { TerrainSurveyState } from "./terrain-survey-window";

export const useTerrainSurvey = (store: ReadableStore<TerrainSurveyState>) => {
  const { i18n } = useLingui();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const target = state.target;
  if (!target) return null;
  const tool = target.job === "Scout" ? "spyglass" : "hammer";
  return {
    ...state,
    description: i18n._(target.job === "Scout" ? M.terrain.scoutDescription : M.terrain.geologistDescription),
    label: translateMessage(i18n, M.terrain.send, { job: target.job }),
    tool
  };
};

