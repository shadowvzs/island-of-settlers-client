import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  campaignGraphOf, campaignNodeView, type CampaignProgress
} from "../../island-of-settlers-shared/src/campaign/campaign-graph";
import {
  type Campaign, type CampaignEdge, type CampaignMap, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignProgressAnswer } from "../src/app/cloud/economy-client";
import { createCampaignWindowPort } from "../src/app/settlement/campaign-window-port";
import { CampaignMapList } from "../src/app/settlement-ui/campaign-window/campaign-map-list";
import { CampaignPathGraph } from "../src/app/settlement-ui/campaign-window/campaign-path-graph";
import { campaignDepartModel, campaignMapRows } from "../src/app/settlement-ui/campaign-window/helpers";
import { pathGraphModel } from "../src/app/settlement-ui/campaign-window/path-graph-helpers";
import type { CampaignRequirementStatus } from "../src/shared/campaign/campaign-requirements";
import { expeditionHarbourFixture } from "./helpers/colony-expedition-harbour";

/**
 * BR4 branching fixture: Harbour's victory leads to the Ford, its exit "Spare the village" to the Village
 * (exclusive branch); the Village forks to the Mill and the Tower (both open at once); every other map ends.
 */
const edgeOf = (id: number, from: string, exit: string, to: string | null): CampaignEdge =>
  ({ exit, from, id: `edge-${id}`, to });
const CAMPAIGN: Campaign = {
  ...createCampaign("paths"), edges: [
    edgeOf(1, "harbour", "victory", "ford"), edgeOf(2, "harbour", "exit-1", "village"),
    edgeOf(3, "village", "victory", "mill"), edgeOf(4, "village", "victory", "tower"),
    edgeOf(5, "ford", "victory", null), edgeOf(6, "mill", "victory", null), edgeOf(7, "tower", "victory", null)
  ],
  mapIds: ["harbour", "ford", "mill", "tower", "village"], name: { en: "Paths" }, nextEdgeNumber: 8,
  startMapIds: ["harbour"], state: "ready"
};
const mapOf = (id: string, patch: Partial<CampaignMap> = {}): CampaignMap => ({
  ...createCampaignMap(id, "paths", { hash: null, id: `slot-${id}` }), name: { en: `The ${id}` }, state: "ready",
  unlock: [], ...patch
});
const MAPS = [
  mapOf("harbour", { exits: [{ id: "exit-1", name: { en: "Spare the village" } }], nextExitNumber: 2 }),
  mapOf("ford"), mapOf("mill"), mapOf("tower"), mapOf("village")
];
const SPARED: CampaignProgress = new Map([["harbour", { exit: "exit-1" }]]);

/** The server's progress answer (BR1 `progressAnswerOf`) over the shared node view. */
const answerOf = (progress: CampaignProgress): CampaignProgressAnswer => {
  const view = campaignNodeView(campaignGraphOf(CAMPAIGN, new Map(MAPS.map(map => [map.id, map]))),
    new Map(MAPS.map(map => [map.id, map])), progress);
  return {
    completed: view.completed, edges: view.edges.map(({ edge, state }) => ({ id: edge.id, state })),
    maps: view.nodes.map(node => ({ mapId: node.mapId, node: node.state,
      status: node.state === "closed" ? "notAvailable" : node.state, ...node.exit ? { exit: node.exit } : {} }))
  };
};

const portOf = (answer?: CampaignProgressAnswer) => createCampaignWindowPort({
  ...answer ? { economy: { campaignProgress: async () => answer } } : {},
  now: () => 0,
  openRepositories: async () => ({
    campaigns: { list: async () => [CAMPAIGN] } as never,
    maps: { list: async () => MAPS } as never
  }),
  operation: () => null,
  readMap: async () => ({ error: "", loaded: null }),
  simulation: expeditionHarbourFixture().simulation,
  start: async () => true
});
const READY: CampaignRequirementStatus = {
  idleShips: 1, levelBlock: null, lines: [], operationBlock: null, reason: null, shipsNeeded: 1
};

describe("campaign window graph state (BR4)", () => {
  it("shows completed with the exit name, available, closed and locked rows in graph order", async () => {
    const [choice] = await portOf(answerOf(SPARED)).load();
    const rows = campaignMapRows(choice, "ford");
    expect(rows.map(row => [row.id, row.node, row.icon, row.detail])).toEqual([
      ["harbour", "completed", "apply", "Won: Spare the village"],
      ["ford", "closed", "cancel", "Another path was chosen"],
      ["village", "available", "campaign", ""],
      ["mill", "notAvailable", "campaign", ""],
      ["tower", "notAvailable", "campaign", ""]
    ]);
    expect(rows.map(row => row.name)).toEqual(["1. The harbour", "2. The ford", "3. The village", "4. The mill",
      "5. The tower"]);
    expect(rows[1]!.className).toContain("campaign-window__map--closed");
    expect(rows[1]!.statusText).toBe("Another path was chosen");
    expect(choice!.edges.map(({ edge, state }) => `${edge.id}:${state}`)).toEqual([
      "edge-1:closed", "edge-2:taken", "edge-3:open", "edge-4:open", "edge-5:closed", "edge-6:open", "edge-7:open"
    ]);
    expect(choice!.completed).toBe(false);
  });

  it("disables Set sail on a closed map", async () => {
    const [choice] = await portOf(answerOf(SPARED)).load();
    const ford = choice!.maps.find(entry => entry.map.id === "ford")!;
    expect(ford.status).toBe("notAvailable");
    expect(campaignDepartModel(ford.node, READY, "roman", false))
      .toMatchObject({ disabled: true, hint: "Another path was chosen" });
  });

  it("opens both targets of a fork and reports a reached ending", async () => {
    const progress: CampaignProgress = new Map([...SPARED, ["village", { exit: "victory" }],
      ["tower", { exit: "victory" }]]);
    const [choice] = await portOf(answerOf(progress)).load();
    expect(choice!.maps.map(entry => `${entry.map.id}:${entry.node}`))
      .toEqual(["harbour:completed", "ford:closed", "village:completed", "mill:available", "tower:completed"]);
    expect(choice!.completed).toBe(true);
    // The implicit exit has no name: no "Won" line.
    expect(campaignMapRows(choice, undefined)[2]!.detail).toBe("");
  });

  it("computes the guest/offline states with the shared graph helpers", async () => {
    const [choice] = await portOf().load();
    expect(choice!.maps.map(entry => `${entry.map.id}:${entry.node}`))
      .toEqual(["harbour:available", "ford:notAvailable", "village:notAvailable", "mill:notAvailable",
        "tower:notAvailable"]);
    expect(choice!.edges.every(({ state }) => state === "open")).toBe(true);
  });
});

describe("campaign path graph (BR4)", () => {
  it("lays the maps out by graph layer and styles the paths by state", async () => {
    const [choice] = await portOf(answerOf(SPARED)).load();
    const graph = pathGraphModel(choice, "village");
    expect(graph.nodes.map(node => `${node.label}:${node.id}@${node.left},${node.top}`)).toEqual([
      "1:harbour@42,54", "2:ford@126,22", "3:village@126,86", "4:mill@210,22", "5:tower@210,86"
    ]);
    expect(graph).toMatchObject({ height: 128, viewBox: "0 0 252 128", width: 252 });
    expect(graph.nodes[2]).toMatchObject({ className: "campaign-window__path-node campaign-window__path-node--available "
      + "campaign-window__path-node--selected", name: "The village", title: "3. The village: Available" });
    expect(graph.nodes[1]!.title).toBe("2. The ford: Another path was chosen");
    expect(graph.edges.map(edge => `${edge.id}:${edge.className.split("--")[1]}`))
      .toEqual(["harbour>ford:closed", "harbour>village:taken", "village>mill:open", "village>tower:open"]);
    expect(graph.endings.map(ending => `${ending.id}:${ending.className.split("--")[1]}`))
      .toEqual(["ford>:closed", "mill>:open", "tower>:open"]);
    // The head's tip stops at the target circle's rim (gap 21 px), the shaft at the head's base (9 px).
    const arrow = graph.edges.find(edge => edge.id === "village>mill")!;
    const [tipX, tipY] = arrow.head.split(" ")[0]!.split(",").map(Number) as [number, number];
    expect(Math.hypot(210 - tipX, 22 - tipY)).toBeCloseTo(21, 1);
    expect(Math.hypot(tipX - arrow.x2, tipY - arrow.y2)).toBeCloseTo(9, 1);
  });

  it("keeps a linear campaign on one row; an edge back to an earlier map does not move the layout", () => {
    const maps = ["one", "two"].map(id => ({ exit: null, map: mapOf(id), node: "available" as const,
      status: "available" as const }));
    const edges = [{ edge: edgeOf(1, "one", "victory", "two"), state: "open" as const },
      { edge: edgeOf(2, "two", "victory", "one"), state: "open" as const }];
    const graph = pathGraphModel({ campaign: CAMPAIGN, completed: false, edges, maps }, undefined);
    expect(graph.nodes.map(node => [node.left, node.top])).toEqual([[42, 22], [126, 22]]);
    expect(graph.edges.map(edge => edge.id)).toEqual(["one>two", "two>one"]);
    expect(pathGraphModel(undefined, undefined)).toMatchObject({ edges: [], nodes: [], width: 84 });
  });

  it("renders rows with their detail line and graph nodes as buttons", async () => {
    const [choice] = await portOf(answerOf(SPARED)).load();
    const list = renderToStaticMarkup(createElement(CampaignMapList,
      { label: "Maps", rows: campaignMapRows(choice, "harbour"), onSelect: () => undefined }));
    expect(list).toContain('data-status="closed"');
    expect(list).toContain('<span class="campaign-window__map-detail">Won: Spare the village</span>');
    expect(list).toContain('<span class="campaign-window__map-detail">Another path was chosen</span>');
    const graph = renderToStaticMarkup(createElement(CampaignPathGraph,
      { graph: pathGraphModel(choice, "harbour"), label: "Campaign paths", onSelect: () => undefined }));
    expect(graph.match(/data-campaign-node=/g)).toHaveLength(5);
    expect(graph.match(/<polygon /g)).toHaveLength(4);
    expect(graph.match(/<circle /g)).toHaveLength(3);
    expect(graph).toContain('aria-label="1. The harbour: Completed: a replay pays a third of the home rewards"');
  });
});
