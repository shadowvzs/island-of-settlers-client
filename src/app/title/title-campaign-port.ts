import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  campaignRequiredLevel, type CampaignRequirementStatus, homelessLaunchBlock
} from "../../shared/campaign/campaign-requirements";
import {
  type LocalCampaignProgress, localCampaignProgressOf
} from "../../shared/campaign/local-campaign-progress";
import type { LoadedMap } from "../../shared/world/save/map-reader";
import { type CampaignWindowPortOptions, createCampaignWindowPort } from "../settlement/campaign-window-port";
import { CAMPAIGN_MAP_FILE_MISSING } from "../settlement/constants";
import type { CampaignWindowPort } from "../settlement-ui/campaign-window/types";
import { offeredByTitle } from "./helpers";

export interface TitleCampaignPortOptions {
  /** The slot's campaign progress (map id → exit per campaign). */
  campaignProgress: LocalCampaignProgress | undefined;
  /** The effective level of a run without a home (`titlePlayerLevel`). */
  playerLevel: number;
  settings: GameSettings;
  /** With `economy` (signed in) the server's progress drives the view (ONLINE-STORY). */
  sources: Pick<CampaignWindowPortOptions, "economy" | "now" | "openRepositories" | "readMap">;
  /** Builds the run's first game into the working slot; true, or the English refusal. */
  start(map: CampaignMap, loaded: LoadedMap): Promise<true | string>;
}

/** No home island: the window port's harbour checks never run on the title page (it answers them itself). */
const NO_HOME_SIMULATION: CampaignWindowPortOptions["simulation"] = {
  buildings: () => [],
  campaignRequirements: () => { throw new Error("A title page has no home harbour"); }
};

/** The launch check without a home (rev H5): only the level gate; no cargo, ships or operation slot. */
const homelessStatus = (map: CampaignMap, playerLevel: number): CampaignRequirementStatus => {
  const levelBlock = homelessLaunchBlock(campaignRequiredLevel(map.unlock), playerLevel);
  return { idleShips: 0, levelBlock, lines: [], operationBlock: null, reason: levelBlock, shipsNeeded: 0 };
};

/**
 * The campaign window's port on the title page (plan §7.4 step 3): the ready, offered campaigns (narrowed by the
 * settings' `start.campaignIds`) with the slot's own progress, the level-only launch check and a start that builds
 * the run without a home.
 */
export const createTitleCampaignPort = (options: TitleCampaignPortOptions): CampaignWindowPort => {
  const { campaignProgress, playerLevel, settings, sources } = options;
  const records = createCampaignWindowPort({
    ...sources,
    localProgress: campaignId => localCampaignProgressOf(campaignProgress, campaignId),
    operation: () => null,
    simulation: NO_HOME_SIMULATION,
    start: async () => CAMPAIGN_MAP_FILE_MISSING
  });
  return {
    load: async () => (await records.load()).filter(choice => offeredByTitle(settings, choice.campaign)),
    requirements: map => homelessStatus(map, playerLevel),
    start: async map => {
      const status = homelessStatus(map, playerLevel);
      if (status.reason) return status.reason;
      const file = await sources.readMap(map.mapFile.id);
      if (!file.loaded) return file.error || CAMPAIGN_MAP_FILE_MISSING;
      return options.start(map, file.loaded);
    }
  };
};
