import { createComponentMount } from "../../components/react-island";
import type { ReadableStore } from "../../components/ui-store";
import { WareIcon } from "../../components/ware-icon";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { TerrainSurveyState } from "./terrain-survey-window";
import { useTerrainSurvey } from "./use-terrain-survey";

interface TerrainSurveyActions { dispatch: () => void }
interface TerrainSurveyProps { actions: TerrainSurveyActions; store: ReadableStore<TerrainSurveyState> }

const TerrainSurvey = ({ actions, store }: TerrainSurveyProps) => {
  const state = useTerrainSurvey(store);
  if (!state) return null;
  return (
    <>
      <p>{state.description}</p>
      <div className="settlement-ui__terrain-survey-actions">
      <button className="settlement-ui__button" type="button" onClick={actions.dispatch}>
        <WareIcon ware={state.tool} /><span>{state.label}</span>
      </button>
      </div>
      {state.error && <p role="status">{state.error}</p>}
    </>
  );
};

export const createTerrainSurveyMount = (
  store: ReadableStore<TerrainSurveyState>, _visibility: SettlementWindowVisibilityStore, actions: TerrainSurveyActions
) => createComponentMount(TerrainSurvey, { actions, store });
