import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  campaignRecordScript, hasRecordScript
} from "../../../../island-of-settlers-shared/src/campaign/campaign-record-script";
import { freezeMapScript } from "../../../../island-of-settlers-shared/src/script/hash";
import type { MapScript } from "../../../../island-of-settlers-shared/src/script/types/script";
import type { WorldData } from "./world-data";

/**
 * The one accessor for a map's script (TRG1; QU §4.3 `questBookOf`, renamed): the map file's header script, else
 * a campaign record's not yet moved quests/regions/cinematics converted on the fly (the record → file move is
 * C7b's editor step), else none (the shipped default home book arrives with QU3/TRG6). Runtimes that start a map
 * set `world.script` from this before the simulation starts, so the start snapshot and saves see one script.
 */
export const scriptOf = (world: Pick<WorldData, "script">, campaignMap?: CampaignMap | null): MapScript | null => {
  if (world.script) return world.script;
  if (campaignMap && hasRecordScript(campaignMap)) return freezeMapScript(campaignRecordScript(campaignMap));
  return null;
};
