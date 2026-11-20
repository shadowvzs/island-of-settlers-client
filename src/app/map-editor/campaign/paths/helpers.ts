import {
  CAMPAIGN_DEFAULT_EXIT, CAMPAIGN_EDGE_ID_PREFIX, CAMPAIGN_EXIT_ID_PREFIX, CAMPAIGN_LIMITS
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import {
  type CampaignGraph, campaignGraphOf, exitsOf
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type {
  Campaign, CampaignEdge, CampaignMap, CampaignMapExit
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { TranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { editorMessage, type EditorText } from "../../messages";
import { displayText } from "../helpers";
import { CAMPAIGN_PATH_MESSAGES as PM } from "./messages";

/**
 * Campaign graph edits of the editor (BR3, plan §9): exits on the map records, edges and start maps on the campaign
 * record. Pure transforms; the first graph edit of a linear campaign writes its derived graph explicitly (plan §11).
 */

export const mapsById = (maps: readonly CampaignMap[]) => new Map(maps.map(map => [map.id, map]));

/** The campaign's graph (stored, or derived from the linear order) over the working maps. */
export const graphOf = (campaign: Campaign, maps: readonly CampaignMap[]): CampaignGraph =>
  campaignGraphOf(campaign, mapsById(maps));

/** The number after `<prefix><n>` ids and the stored counter, so a new id never repeats an old one. */
const nextNumber = (stored: number | undefined, ids: readonly string[], prefix: string) => ids.reduce((next, id) => {
  const number = Number(id.slice(prefix.length));
  return id.startsWith(prefix) && Number.isInteger(number) ? Math.max(next, number + 1) : next;
}, Math.max(stored ?? 1, 1));

/** The campaign with `edges` appended, each given the next `edge-<n>` id. */
const withEdgesAdded = (campaign: Campaign, added: readonly Omit<CampaignEdge, "id">[]): Campaign => {
  const edges = campaign.edges ?? [];
  let number = nextNumber(campaign.nextEdgeNumber, edges.map(edge => edge.id), CAMPAIGN_EDGE_ID_PREFIX);
  const created = added.map(edge => ({ ...edge, id: `${CAMPAIGN_EDGE_ID_PREFIX}${number++}` }));
  return { ...campaign, edges: [...edges, ...created], nextEdgeNumber: number };
};

/** A linear campaign with its derived graph written out (same starts and paths); a stored graph stays as it is. */
export const withExplicitGraph = (campaign: Campaign, maps: readonly CampaignMap[]): Campaign => {
  if (campaign.edges) return campaign;
  const graph = graphOf(campaign, maps);
  const derived = graph.edges.map(({ exit, from, to }) => ({ exit, from, to }));
  return withEdgesAdded({ ...campaign, edges: [], startMapIds: [...graph.starts] }, derived);
};

/**
 * "Make linear": the first map starts, every exit of each map (the named ones too) leads to the next map, the last
 * map's exits end the campaign. Existing edges are replaced; edge ids keep counting up.
 */
export const withLinearGraph = (campaign: Campaign, maps: readonly CampaignMap[]): Campaign => {
  const byId = mapsById(maps);
  const edges = campaign.mapIds.flatMap((from, index) => {
    const map = byId.get(from);
    const to = campaign.mapIds[index + 1] ?? null;
    return (map ? exitsOf(map) : [CAMPAIGN_DEFAULT_EXIT]).map(exit => ({ exit, from, to }));
  });
  const nextEdgeNumber = nextNumber(campaign.nextEdgeNumber, (campaign.edges ?? []).map(edge => edge.id),
    CAMPAIGN_EDGE_ID_PREFIX);
  return withEdgesAdded({ ...campaign, edges: [], nextEdgeNumber, startMapIds: campaign.mapIds.slice(0, 1) }, edges);
};

/** The maps an exit leads to (`null`: the campaign ends), in edge order. */
export const exitTargets = (graph: CampaignGraph, mapId: string, exit: string) =>
  graph.edges.filter(edge => edge.from === mapId && edge.exit === exit).map(edge => edge.to);

/** True while the campaign may store one more edge (plan limit: listed maps × 4). */
export const canAddEdge = (campaign: Campaign) =>
  (campaign.edges?.length ?? campaign.mapIds.length) < campaign.mapIds.length * CAMPAIGN_LIMITS.edgesPerMap;

/** Adds or removes the edge `from —exit→ to` (graph made explicit first); over the edge limit nothing changes. */
export const withExitTarget = (
  campaign: Campaign, maps: readonly CampaignMap[], path: Omit<CampaignEdge, "id">, leads: boolean
): Campaign => {
  const explicit = withExplicitGraph(campaign, maps);
  const edges = explicit.edges ?? [];
  const matches = (edge: CampaignEdge) => edge.from === path.from && edge.exit === path.exit && edge.to === path.to;
  if (!leads) return { ...explicit, edges: edges.filter(edge => !matches(edge)) };
  if (edges.some(matches) || !canAddEdge(explicit)) return explicit;
  return withEdgesAdded(explicit, [path]);
};

/** Adds or removes a start map (graph made explicit first). */
export const withStartMap = (
  campaign: Campaign, maps: readonly CampaignMap[], mapId: string, start: boolean
): Campaign => {
  const explicit = withExplicitGraph(campaign, maps);
  const others = (explicit.startMapIds ?? []).filter(id => id !== mapId);
  const startMapIds = start ? explicit.mapIds.filter(id => id === mapId || others.includes(id)) : others;
  return { ...explicit, startMapIds };
};

/** The campaign without edges from or to `mapId` and without it as a start map (an unlisted or deleted map). */
export const withoutGraphMap = (campaign: Campaign, mapId: string): Campaign => {
  if (!campaign.edges && !campaign.startMapIds) return campaign;
  const next = { ...campaign };
  if (campaign.edges) next.edges = campaign.edges.filter(edge => edge.from !== mapId && edge.to !== mapId);
  if (campaign.startMapIds) next.startMapIds = campaign.startMapIds.filter(id => id !== mapId);
  return next;
};

/** True while the map may declare one more named exit. */
export const canAddExit = (map: CampaignMap) => (map.exits?.length ?? 0) < CAMPAIGN_LIMITS.exitsPerMap;

/** The map with a new named exit `exit-<n>` ("Exit <n>"); at the limit the map stays unchanged. */
export const withExitAdded = (map: CampaignMap): CampaignMap => {
  if (!canAddExit(map)) return map;
  const exits = map.exits ?? [];
  const number = nextNumber(map.nextExitNumber, exits.map(exit => exit.id), CAMPAIGN_EXIT_ID_PREFIX);
  const exit: CampaignMapExit = { id: `${CAMPAIGN_EXIT_ID_PREFIX}${number}`, name: { en: `Exit ${number}` } };
  return { ...map, exits: [...exits, exit], nextExitNumber: number + 1 };
};

const withExitChange = (map: CampaignMap, exitId: string, change: (exit: CampaignMapExit) => CampaignMapExit) =>
  ({ ...map, exits: (map.exits ?? []).map(exit => (exit.id === exitId ? change(exit) : exit)) });

export const withExitName = (map: CampaignMap, exitId: string, name: TranslatableText): CampaignMap =>
  withExitChange(map, exitId, exit => ({ ...exit, name }));

/** The exit's own epilogue sequence; "" falls back to the map's victory epilogue. */
export const withExitSequence = (map: CampaignMap, exitId: string, sequenceId: string): CampaignMap =>
  withExitChange(map, exitId, ({ victorySequenceId: _previous, ...exit }) =>
    (sequenceId ? { ...exit, victorySequenceId: sequenceId } : exit));

/**
 * Why an exit cannot be deleted (plan §5.5, §9): a Ready map keeps its exits (accounts may have stored them), and an
 * exit that still leads somewhere is in use (`targets`). Null: deletable.
 */
export type ExitDeleteRefusal = { kind: "ready" } | { kind: "used"; targets: (string | null)[] };

export const exitDeleteRefusal = (graph: CampaignGraph, map: CampaignMap, exitId: string): ExitDeleteRefusal | null => {
  if (map.state === "ready") return { kind: "ready" };
  const targets = exitTargets(graph, map.id, exitId);
  return targets.length ? { kind: "used", targets } : null;
};

/** Display names of edge targets (`null`: the campaign end label). */
export const targetNames = (
  targets: readonly (string | null)[], maps: readonly CampaignMap[], language: string, endLabel: string
) => {
  const byId = mapsById(maps);
  return targets.map(target => {
    if (target === null) return endLabel;
    const map = byId.get(target);
    return map ? displayText(map.name, language, target) : target;
  });
};

/** The display name of an exit of `map` (the implicit victory exit: its id). */
export const exitName = (map: CampaignMap, exitId: string, language: string) => {
  const exit = map.exits?.find(entry => entry.id === exitId);
  return exit ? displayText(exit.name, language, exitId) : exitId;
};

/** The notice or tooltip text of a refused exit deletion. */
export const exitRefusalText = (
  refusal: ExitDeleteRefusal, map: CampaignMap, exitId: string, maps: readonly CampaignMap[], endLabel: string,
  language = "en"
): EditorText => {
  if (refusal.kind === "ready") return PM.deleteRefusedReady;
  const targets = targetNames(refusal.targets, maps, language, endLabel).join(", ");
  return editorMessage(PM.deleteRefusedUsed, { name: exitName(map, exitId, language), targets });
};

export const withExitDeleted = (map: CampaignMap, exitId: string): CampaignMap =>
  ({ ...map, exits: (map.exits ?? []).filter(exit => exit.id !== exitId) });

export const hasPreviousMapLock = (map: CampaignMap) =>
  map.unlock.some(condition => condition.kind === "previousMapCompleted");

/** A branching campaign ignores `previousMapCompleted` (plan §11); the editor offers to remove it. */
export const hasUnusedPreviousMapLock = (campaign: Campaign, map: CampaignMap) =>
  campaign.edges !== undefined && hasPreviousMapLock(map);

export const withoutPreviousMapLock = (map: CampaignMap): CampaignMap =>
  ({ ...map, unlock: map.unlock.filter(condition => condition.kind !== "previousMapCompleted") });
