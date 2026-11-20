import type { Campaign, CampaignMap } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { parseIssuePath } from "../../script/paths";
import { exitName } from "../paths/helpers";

/**
 * Campaign graph issues in the Check (BR3): which map an edge or start map issue belongs to (its jump selects that
 * map) and readable names for the map and exit ids in their messages.
 */

/** The map a campaign document issue about the graph concerns: the edge's `from`, a start map, or `mapId`. */
export const graphIssueMapId = (
  path: string, params: Readonly<Record<string, unknown>>, campaign: Campaign
): string | null => {
  const [field, index] = parseIssuePath(path);
  if (field === "edges" && typeof index === "number") return campaign.edges?.[index]?.from ?? null;
  if (field === "startMapIds" && typeof index === "number") return campaign.startMapIds?.[index] ?? null;
  return typeof params.mapId === "string" ? params.mapId : null;
};

/** Issue parameters with map ids (`mapId`, `from`, `to`) as display names and `exit` as the exit's name. */
export const namedGraphParams = (
  params: Readonly<Record<string, unknown>>, maps: readonly CampaignMap[], mapNames: ReadonlyMap<string, string>,
  language: string
) => {
  const named: Record<string, unknown> = { ...params };
  for (const key of ["mapId", "from", "to"]) {
    const name = mapNames.get(String(params[key]));
    if (name) named[key] = name;
  }
  const map = maps.find(entry => entry.id === params.mapId);
  if (map && typeof params.exit === "string") named.exit = exitName(map, params.exit, language);
  return named;
};
