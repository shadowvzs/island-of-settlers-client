import type { CampaignGraph } from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { CampaignMap } from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { displayText } from "../../helpers";

/** One listed map of the start map picker (the derived starts of a linear campaign are shown checked). */
export interface StartMapChoice {
  checked: boolean;
  id: string;
  name: string;
}

export const startMapChoices = (
  graph: CampaignGraph, maps: readonly CampaignMap[], language: string
): StartMapChoice[] => {
  const names = new Map(maps.map(map => [map.id, displayText(map.name, language, map.id)]));
  const starts = new Set(graph.starts);
  return graph.mapIds.map(id => ({ checked: starts.has(id), id, name: names.get(id) ?? id }));
};
