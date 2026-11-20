import { describe, expect, it } from "vitest";

import { validateCampaignGraph } from "../../island-of-settlers-shared/src/campaign/campaign-graph-validation";
import {
  type Campaign, type CampaignMap, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { checkCampaignShape } from "../../island-of-settlers-shared/src/campaign/campaign-shape";
import { campaignMapSlotId } from "../src/app/map-editor/campaign/helpers";
import { newCampaignMap, unlistMap } from "../src/app/map-editor/campaign/map-list/helpers";
import { mapViewModel, setNodePosition } from "../src/app/map-editor/campaign/map-view/helpers";
import {
  canAddExit, exitDeleteRefusal, exitTargets, graphOf, hasUnusedPreviousMapLock, mapsById, withExitAdded,
  withExitDeleted, withExitSequence, withExitTarget, withExplicitGraph, withLinearGraph, withoutPreviousMapLock,
  withStartMap
} from "../src/app/map-editor/campaign/paths/helpers";

const map = (id: string, overrides: Partial<CampaignMap> = {}): CampaignMap => ({
  ...createCampaignMap(id, "campaign-1", { hash: null, id: campaignMapSlotId("campaign-1", id) }),
  name: { en: `Name ${id}` },
  ...overrides
});
const campaign = (mapIds: string[], overrides: Partial<Campaign> = {}): Campaign =>
  ({ ...createCampaign("campaign-1"), mapIds, ...overrides });
const issueCodes = (record: Campaign, maps: readonly CampaignMap[]) =>
  validateCampaignGraph(record, mapsById(maps)).map(issue => `${issue.code}:${issue.params.mapId ?? ""}`);

describe("campaign paths: writing the graph", () => {
  it("writes a linear campaign's derived graph once, with edge ids and counter", () => {
    const maps = [map("a"), map("b"), map("c", { unlock: [] })];
    const explicit = withExplicitGraph(campaign(["a", "b", "c"]), maps);
    expect(explicit.edges).toEqual([
      { exit: "victory", from: "a", id: "edge-1", to: "b" }, { exit: "victory", from: "b", id: "edge-2", to: "c" },
      { exit: "victory", from: "c", id: "edge-3", to: null }
    ]);
    expect(explicit.startMapIds).toEqual(["a", "c"]);
    expect(explicit.nextEdgeNumber).toBe(4);
    expect(withExplicitGraph(explicit, maps)).toBe(explicit);
    expect(checkCampaignShape(explicit)).toEqual([]);
  });

  it("toggles an exit target; a removed edge id is never reused", () => {
    const maps = [map("a"), map("b"), map("c")];
    let record = withExitTarget(campaign(["a", "b", "c"]), maps, { exit: "victory", from: "a", to: "c" }, true);
    expect(exitTargets(graphOf(record, maps), "a", "victory")).toEqual(["b", "c"]);
    record = withExitTarget(record, maps, { exit: "victory", from: "a", to: "c" }, false);
    record = withExitTarget(record, maps, { exit: "victory", from: "a", to: "c" }, true);
    expect(record.edges!.at(-1)!.id).toBe("edge-5");
    expect(withExitTarget(record, maps, { exit: "victory", from: "a", to: "c" }, true).edges).toHaveLength(4);
  });

  it("refuses an edge beyond the limit of listed maps × 4", () => {
    const maps = [map("a")];
    let record = withExplicitGraph(campaign(["a"]), maps);
    for (let index = 0; index < 6; index++)
      record = withExitTarget(record, maps, { exit: `exit-${index}`, from: "a", to: null }, true);
    expect(record.edges).toHaveLength(4);
  });

  it("toggles start maps in play order", () => {
    const maps = [map("a"), map("b"), map("c")];
    let record = withStartMap(campaign(["a", "b", "c"]), maps, "c", true);
    expect(record.startMapIds).toEqual(["a", "c"]);
    record = withStartMap(record, maps, "a", false);
    expect(record.startMapIds).toEqual(["c"]);
  });

  it("make linear leads every exit to the next map and starts with the first", () => {
    const maps = [withExitAdded(map("a")), map("b")];
    const branching = withExitTarget(campaign(["a", "b"]), maps, { exit: "victory", from: "b", to: "a" }, true);
    const linear = withLinearGraph(branching, maps);
    expect(linear.startMapIds).toEqual(["a"]);
    expect(linear.edges!.map(({ exit, from, to }) => `${from}.${exit}>${to}`))
      .toEqual(["a.victory>b", "a.exit-1>b", "b.victory>null"]);
    expect(linear.edges![0]!.id).toBe(`edge-${branching.nextEdgeNumber}`);
    expect(issueCodes(linear, maps.map(withoutPreviousMapLock))).toEqual([]);
  });

  it("unlisting a map drops its edges and start entry", () => {
    const maps = [map("a"), map("b")];
    const record = unlistMap(withStartMap(campaign(["a", "b"]), maps, "b", true), "b");
    expect(record.edges).toEqual([]);
    expect(record.startMapIds).toEqual(["a"]);
    expect(unlistMap(campaign(["a", "b"]), "b").edges).toBeUndefined();
  });
});

describe("campaign paths: exits", () => {
  it("adds exits with counted ids up to the limit", () => {
    let record = map("a");
    for (let index = 0; index < 9; index++) record = withExitAdded(record);
    expect(record.exits!.map(exit => exit.id)).toEqual(Array.from({ length: 8 }, (_, index) => `exit-${index + 1}`));
    expect(canAddExit(record)).toBe(false);
    expect(withExitAdded(withExitDeleted(withExitAdded(map("b")), "exit-1")).exits![0]!.id).toBe("exit-2");
  });

  it("sets and clears an exit epilogue", () => {
    const record = withExitSequence(withExitAdded(map("a")), "exit-1", "sequence-1");
    expect(record.exits![0]!.victorySequenceId).toBe("sequence-1");
    expect(withExitSequence(record, "exit-1", "").exits![0]).not.toHaveProperty("victorySequenceId");
  });

  it("refuses deleting an exit of a Ready map or one that still leads somewhere", () => {
    const draftMap = withExitAdded(map("a")), maps = [draftMap, map("b")];
    const record = withExitTarget(campaign(["a", "b"]), maps, { exit: "exit-1", from: "a", to: null }, true);
    expect(exitDeleteRefusal(graphOf(record, maps), draftMap, "exit-1")).toEqual({ kind: "used", targets: [null] });
    expect(exitDeleteRefusal(graphOf(record, maps), { ...draftMap, state: "ready" }, "exit-1"))
      .toEqual({ kind: "ready" });
    expect(exitDeleteRefusal(graphOf(campaign(["a", "b"]), maps), draftMap, "exit-1")).toBeNull();
  });

  it("a branching campaign offers to remove the previous-map lock; its new maps have none", () => {
    const linear = campaign(["a"]), branching = withExplicitGraph(linear, [map("a")]);
    expect(hasUnusedPreviousMapLock(linear, map("a"))).toBe(false);
    expect(hasUnusedPreviousMapLock(branching, map("a"))).toBe(true);
    expect(hasUnusedPreviousMapLock(branching, withoutPreviousMapLock(map("a")))).toBe(false);
    expect(newCampaignMap(linear, "m", 2))
      .toMatchObject({ name: { en: "Map 2" }, unlock: [{ kind: "previousMapCompleted" }] });
    expect(newCampaignMap(branching, "m", 2).unlock).toEqual([]);
  });

  it("a two-branch campaign authored through the helpers has no graph issue", () => {
    const maps = [withExitAdded(map("a")), map("b"), map("c")];
    let record = campaign(["a", "b", "c"]);
    record = withExitTarget(record, maps, { exit: "victory", from: "b", to: null }, true);
    record = withExitTarget(record, maps, { exit: "victory", from: "b", to: "c" }, false);
    record = withExitTarget(record, maps, { exit: "exit-1", from: "a", to: "c" }, true);
    expect(record.startMapIds).toEqual(["a"]);
    expect(issueCodes(record, maps)).toEqual(["a", "b", "c"].map(id => `campaignPreviousMapLockUnused:${id}`));
    expect(issueCodes(record, maps.map(withoutPreviousMapLock))).toEqual([]);
  });
});

describe("campaign paths: map view", () => {
  it("draws one arrow per joined pair, end markers, and numbers nodes in graph order", () => {
    const maps = [withExitAdded(map("a")), map("b"), map("c")];
    let record = campaign(["c", "a", "b"]);
    record = withStartMap(record, maps, "a", true);
    record = withStartMap(record, maps, "c", false);
    record = withExitTarget(record, maps, { exit: "exit-1", from: "a", to: "b" }, true);
    record = withExitTarget(record, maps, { exit: "victory", from: "c", to: "a" }, false);
    record = withExitTarget(record, maps, { exit: "victory", from: "a", to: "b" }, true);
    record = withExitTarget(record, maps, { exit: "victory", from: "b", to: "c" }, true);
    record = setNodePosition(setNodePosition(record, "a", 0.1, 0.5), "b", 0.5, 0.5);
    const { endings, nodes, paths } = mapViewModel(record, maps, null, "en", 2);
    expect(nodes.map(node => `${node.id}${node.label}`)).toEqual(["c3", "a1", "b2"]);
    expect(paths.map(path => path.id)).toEqual(["a>b", "b>c"]);
    expect(paths[0]).toMatchObject({ y1: 50, y2: 50 });
    expect(paths[0]!.x1).toBeCloseTo(20 + 4.5);
    expect(paths[0]!.x2).toBeCloseTo(100 - 4.5 - 3);
    expect(paths[0]!.head).toBe("95.50,50.00 92.50,51.60 92.50,48.40");
    expect(endings.map(ending => ending.id)).toEqual(["b>end"]);
  });
});
