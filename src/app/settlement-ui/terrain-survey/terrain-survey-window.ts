import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { SurveyAssignmentResult, SurveyJob } from "../../../shared/settlement/settlement-surveying";
import type { SettlementPoint } from "../../../shared/settlement/settlement-types";
import { createExternalStore } from "../../components/ui-store";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { TerrainSurveyTarget } from "./helpers";

export interface TerrainSurveyState {
  error: string;
  target: TerrainSurveyTarget | null;
}

interface TerrainSurveyOptions {
  onDispatch: (job: SurveyJob, point: SettlementPoint) => SurveyAssignmentResult;
  onValidate: (point: SettlementPoint) => TerrainSurveyTarget | null;
}

/** The chosen target belongs to this island; hiding the dialog never cancels an accepted worker. */
export const createTerrainSurveyWindow = ({ onDispatch, onValidate }: TerrainSurveyOptions, i18n?: I18n) => {
  const store = createExternalStore<TerrainSurveyState>({ error: "", target: null });
  let disposed = false;
  const dispatch = () => {
    const { target } = store.getSnapshot();
    if (!target || disposed) return;
    const current = onValidate(target.point);
    if (!current || current.job !== target.job) {
      store.set({ error: translateMessage(i18n, M.terrain.stale), target });
      return;
    }
    const result = onDispatch(target.job, target.point);
    if (!result.ok) { store.set({ error: result.reason, target }); return; }
    store.set({ error: "", target: null });
    frame.close();
  };
  const frame = createReactSettlementWindow({
    className: "settlement-ui__terrain-survey-window",
    contentClassName: "settlement-ui__terrain-survey",
    heading: translateMessage(i18n, M.terrain.title), id: "terrain-survey-title",
    load: async visibility => (await import("./mount")).createTerrainSurveyMount(
      store, visibility, { dispatch })
  });
  const keys = new AbortController();
  frame.root.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); frame.close();
  }, { signal: keys.signal });
  return {
    close: frame.close,
    root: frame.root,
    open: (target: TerrainSurveyTarget) => {
      if (disposed) return;
      store.set({ error: "", target });
      frame.setTitle(translateMessage(i18n,
        target.job === "Scout" ? M.terrain.scoutTitle : M.terrain.geologistTitle));
      frame.open();
    },
    dispose: () => { disposed = true; keys.abort(); frame.dispose(); }
  };
};
