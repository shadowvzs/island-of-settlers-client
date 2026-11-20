import type { TranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import type { CampaignEditorCore } from "./campaign-editor-core";
import {
  exitDeleteRefusal, exitRefusalText, graphOf, withExitAdded, withExitDeleted, withExitName, withExitSequence,
  withExitTarget, withExplicitGraph, withLinearGraph, withoutPreviousMapLock, withStartMap
} from "./paths/helpers";
import { CAMPAIGN_PATH_MESSAGES as PM } from "./paths/messages";

/** One "Leads to" choice: the edge `from —exit→ to` (`to` null: the campaign ends). */
export interface CampaignPathChoice {
  exit: string;
  from: string;
  to: string | null;
}

/** The campaign graph edits (BR3): exits on the maps, edges and start maps on the campaign, "Make linear". */
export const createCampaignPathActions = (core: CampaignEditorCore) => {
  const { deps, state } = core;
  const maps = () => state().maps;

  return {
    /** A named exit on the map; a linear campaign stores its graph first (the new exit then needs a path). */
    addExit: (mapId: string) => {
      core.updateDraft(campaign => withExplicitGraph(campaign, maps()));
      core.updateMap(mapId, withExitAdded);
    },
    /** Refused (with the reason as notice) for a Ready map or an exit that still leads somewhere. */
    deleteExit: (mapId: string, exitId: string) => {
      const { draft } = state(), map = maps().find(entry => entry.id === mapId);
      if (!draft || !map) return false;
      const refusal = exitDeleteRefusal(graphOf(draft, maps()), map, exitId);
      if (refusal) {
        core.notify(exitRefusalText(refusal, map, exitId, maps(), deps.translate(PM.campaignEnds)), true);
        return false;
      }
      core.updateMap(mapId, entry => withExitDeleted(entry, exitId));
      return true;
    },
    /** Rebuilds starts and edges from the play order; asks first when the campaign stores a graph. */
    makeLinear: () => {
      const { draft } = state();
      if (!draft) return;
      if (draft.edges?.length && !deps.confirm(deps.translate(PM.confirmLinear))) return;
      core.updateDraft(campaign => withLinearGraph(campaign, maps()));
    },
    removePreviousMapLock: (mapId: string) => core.updateMap(mapId, withoutPreviousMapLock),
    renameExit: (mapId: string, exitId: string, name: TranslatableText) =>
      core.updateMap(mapId, map => withExitName(map, exitId, name)),
    setExitSequence: (mapId: string, exitId: string, sequenceId: string) =>
      core.updateMap(mapId, map => withExitSequence(map, exitId, sequenceId)),
    setExitTarget: ({ exit, from, to }: CampaignPathChoice, leads: boolean) =>
      core.updateDraft(campaign => withExitTarget(campaign, maps(), { exit, from, to }, leads)),
    setStartMap: (mapId: string, start: boolean) =>
      core.updateDraft(campaign => withStartMap(campaign, maps(), mapId, start))
  };
};
