import { CAMPAIGN_DEFAULT_EXIT } from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import type { CampaignGraph } from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type {
  Campaign, CampaignMap, CampaignMapExit
} from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { displayText } from "../../helpers";
import { END_TARGET_KEY } from "../constants";
import { canAddEdge, type ExitDeleteRefusal, exitDeleteRefusal, exitTargets } from "../helpers";

/** One "Leads to" choice of an exit: a listed map other than its own, or the campaign end (`to` null). */
export interface ExitTargetChoice {
  checked: boolean;
  /** Unchecked choices are disabled once the campaign holds its edge limit. */
  disabled: boolean;
  key: string;
  /** The map's display name; null for the campaign end. */
  name: string | null;
  to: string | null;
}

/** One exit of the selected map: the implicit victory exit (`exit` null) first, then the named exits. */
export interface ExitRowModel {
  exit: CampaignMapExit | null;
  id: string;
  refusal: ExitDeleteRefusal | null;
  targets: ExitTargetChoice[];
}

/** One option of an exit's epilogue picker; `name` null is the map's own epilogue, `missing` a deleted sequence. */
export interface SequenceOption {
  missing: boolean;
  name: string | null;
  value: string;
}

const targetChoices = (
  campaign: Campaign, graph: CampaignGraph, names: ReadonlyMap<string, string>, mapId: string, exit: string
): ExitTargetChoice[] => {
  const current = new Set(exitTargets(graph, mapId, exit));
  const full = !canAddEdge(campaign);
  const choice = (to: string | null, name: string | null, key: string) =>
    ({ checked: current.has(to), disabled: full && !current.has(to), key, name, to });
  const maps = campaign.mapIds.filter(id => id !== mapId).map(id => choice(id, names.get(id) ?? id, id));
  return [...maps, choice(null, null, END_TARGET_KEY)];
};

/** The exit rows of `map` with their "Leads to" choices over the campaign graph. */
export const exitRows = (
  campaign: Campaign, graph: CampaignGraph, maps: readonly CampaignMap[], map: CampaignMap, language: string
): ExitRowModel[] => {
  const names = new Map(maps.map(entry => [entry.id, displayText(entry.name, language, entry.id)]));
  const row = (id: string, exit: CampaignMapExit | null): ExitRowModel => ({
    exit, id, refusal: exit ? exitDeleteRefusal(graph, map, id) : null,
    targets: targetChoices(campaign, graph, names, map.id, id)
  });
  return [row(CAMPAIGN_DEFAULT_EXIT, null), ...(map.exits ?? []).map(exit => row(exit.id, exit))];
};

/** The epilogue picker of an exit: the map's epilogue, every sequence of the map, and a deleted selection. */
export const sequenceOptions = (map: CampaignMap, selected: string | undefined): SequenceOption[] => {
  const sequences = map.sequences ?? [];
  const options = [{ missing: false, name: null, value: "" },
    ...sequences.map(sequence => ({ missing: false, name: sequence.name || sequence.id, value: sequence.id }))];
  if (!selected || sequences.some(sequence => sequence.id === selected)) return options;
  return [...options, { missing: true, name: selected, value: selected }];
};
