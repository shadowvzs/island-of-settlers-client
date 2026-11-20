import {
  campaignGraphOf, campaignNodeView
} from "../../../island-of-settlers-shared/src/campaign/campaign-graph";
import {
  type Campaign, type CampaignEdge, type CampaignMap, createCampaign, createCampaignMap
} from "../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignProgressAnswer } from "../../src/app/cloud/economy-client";

/**
 * BR4 review fixture: a branching campaign and an account's server progress over it. The Quiet Bay was won through
 * "The village was spared" (so the Northern Ford branch is closed), the Fishing Village through its victory, which
 * forks to the Old Mill and the Watch Tower (both available); the Last Fortress joins them and is still locked.
 */
const edgeOf = (id: number, from: string, exit: string, to: string | null): CampaignEdge =>
  ({ exit, from, id: `edge-${id}`, to });
const mapOf = (id: string, en: string, hu: string, patch: Partial<CampaignMap> = {}): CampaignMap => ({
  ...createCampaignMap(id, "branching", { hash: null, id: `slot-${id}` }), name: { en, hu }, state: "ready",
  unlock: [], ...patch
});

export const PATHS_MAPS: CampaignMap[] = [
  mapOf("bay", "The Quiet Bay", "A csendes öböl", { exits: [{ id: "exit-1",
    name: { en: "The village was spared", hu: "A falut megkímélték" } }], nextExitNumber: 2 }),
  mapOf("ford", "Northern Ford", "Északi gázló"),
  mapOf("village", "Fishing Village", "Halászfalu"),
  mapOf("mill", "Old Mill", "Régi malom"),
  mapOf("tower", "Watch Tower", "Őrtorony"),
  mapOf("fortress", "The Last Fortress", "Az utolsó erőd")
];

export const PATHS_CAMPAIGN: Campaign = {
  ...createCampaign("branching"),
  edges: [
    edgeOf(1, "bay", "victory", "ford"), edgeOf(2, "bay", "exit-1", "village"), edgeOf(3, "ford", "victory", null),
    edgeOf(4, "village", "victory", "mill"), edgeOf(5, "village", "victory", "tower"),
    edgeOf(6, "mill", "victory", "fortress"), edgeOf(7, "tower", "victory", "fortress"),
    edgeOf(8, "fortress", "victory", null)
  ],
  mapIds: PATHS_MAPS.map(map => map.id), name: { en: "The Branching Isles", hu: "Az elágazó szigetek" },
  nextEdgeNumber: 9, startMapIds: ["bay"], state: "ready"
};

/** The server's `GET /v1/campaign/progress` answer for the fixture account (BR1 `progressAnswerOf`). */
export const pathsProgressAnswer = (): CampaignProgressAnswer => {
  const maps = new Map(PATHS_MAPS.map(map => [map.id, map]));
  const progress = new Map([["bay", { exit: "exit-1" }], ["village", { exit: "victory" }]]);
  const view = campaignNodeView(campaignGraphOf(PATHS_CAMPAIGN, maps), maps, progress);
  return {
    completed: view.completed,
    edges: view.edges.map(({ edge, state }) => ({ id: edge.id, state })),
    maps: view.nodes.map(({ exit, mapId, state }) => ({
      mapId, node: state, status: state === "closed" ? "notAvailable" : state, ...exit ? { exit } : {}
    }))
  };
};
