import { describe, expect, it, vi } from "vitest";

import type { CampaignNodeState } from "../../island-of-settlers-shared/src/campaign/campaign-graph";
import {
  type Campaign, type CampaignMap, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { nodeMapStatus } from "../src/app/settlement/campaign-path-view";
import { createCampaignWindowPort } from "../src/app/settlement/campaign-window-port";
import {
  campaignDepartModel, campaignMapRows, campaignOptions, campaignStartStatus, currentCampaign, currentMap
} from "../src/app/settlement-ui/campaign-window/helpers";
import type { CampaignChoice, CampaignMapChoice } from "../src/app/settlement-ui/campaign-window/types";
import type { CampaignRequirementStatus } from "../src/shared/campaign/campaign-requirements";
import { expeditionHarbourFixture } from "./helpers/colony-expedition-harbour";

/** C8 campaign window: lock state rows, cargo chips and the session port. */
const campaignOf = (patch: Partial<Campaign> = {}): Campaign => ({
  ...createCampaign("isles"), mapIds: ["bay", "cliffs"], name: { en: "The Isles", hu: "A szigetek" },
  state: "ready", ...patch
});
const mapOf = (id: string, patch: Partial<CampaignMap> = {}): CampaignMap => ({
  ...createCampaignMap(id, "isles", { hash: null, id: `slot-${id}` }), name: { en: `Map ${id}` }, state: "ready",
  ...patch
});
const choiceOf = (map: CampaignMap, node: CampaignNodeState, exit: string | null = null): CampaignMapChoice =>
  ({ exit, map, node, status: nodeMapStatus(node) });
const CHOICE: CampaignChoice = { campaign: campaignOf(), completed: false, edges: [], maps: [
  choiceOf(mapOf("bay"), "completed", "victory"), choiceOf(mapOf("cliffs"), "available"),
  choiceOf(mapOf("peak"), "notAvailable")
] };
const statusOf = (patch: Partial<CampaignRequirementStatus> = {}): CampaignRequirementStatus => ({
  idleShips: 1, levelBlock: null, lines: [], operationBlock: null, reason: null, shipsNeeded: 1, ...patch
});

describe("campaign window helpers (C8)", () => {
  it("keeps the chosen campaign and map, else the first playable map", () => {
    expect(currentCampaign([CHOICE], "gone")).toBe(CHOICE);
    expect(currentCampaign([], null)).toBeUndefined();
    expect(currentMap(CHOICE, "peak")!.map.id).toBe("peak");
    expect(currentMap(CHOICE, null)!.map.id).toBe("bay");
    expect(currentMap({ ...CHOICE, maps: [CHOICE.maps[2]!, CHOICE.maps[1]!] }, "gone")!.map.id).toBe("cliffs");
    expect(currentMap({ ...CHOICE, maps: [CHOICE.maps[2]!] }, null)!.map.id).toBe("peak");
    expect(campaignOptions([CHOICE])).toEqual([{ label: "The Isles", value: "isles" }]);
  });

  it("lists the maps in play order with their lock state", () => {
    const rows = campaignMapRows(CHOICE, "cliffs");
    expect(rows.map(row => [row.name, row.node, row.icon, row.selected, row.detail])).toEqual([
      ["1. Map bay", "completed", "apply", false, ""], ["2. Map cliffs", "available", "campaign", true, ""],
      ["3. Map peak", "notAvailable", "campaign", false, ""]
    ]);
    expect(rows[1]!.className)
      .toBe("campaign-window__map campaign-window__map--available campaign-window__map--selected");
    expect(rows[2]!.statusText).toBe("Locked: complete the previous map first");
    expect(campaignMapRows(undefined, undefined)).toEqual([]);
  });

  it("shows what leaves home storage, what is missing and the first refusal", () => {
    const lines: CampaignRequirementStatus["lines"] = [
      { available: 30, item: "shield", kind: "soldiers", missing: 0, required: 10 },
      { available: 12, item: "planks", kind: "goods", missing: 8, required: 20 },
      { available: 3, item: "settlers", kind: "settlers", missing: 0, required: 3 }
    ];
    const blocked = campaignDepartModel("available", statusOf({ idleShips: 0, lines, shipsNeeded: 2,
      reason: "Requires an idle player-owned ship" }), "roman", false);
    expect(blocked.chips.map(chip => [chip.key, chip.amount, chip.className.includes("--missing")])).toEqual([
      ["soldiers:shield", "10/10", false], ["goods:planks", "12/20", true], ["settlers:settlers", "3/3", false]
    ]);
    expect(blocked.chips[1]!.title).toBe("Softwood planks: 12 of 20");
    expect(blocked.chips[2]).toMatchObject({ image: undefined, title: "Idle settlers: 3 of 3" });
    expect(blocked).toMatchObject({ disabled: true, hint: "Requires an idle player-owned ship",
      ships: "Ships: 2 needed, 0 idle", shipsAmount: "0/2" });
    expect(blocked.shipsClassName).toContain("--missing");
    const ready = campaignDepartModel("completed", statusOf({ lines }), "roman", false);
    expect(ready).toMatchObject({ disabled: false, hint: "Everything is ready to sail." });
    expect(campaignDepartModel("available", statusOf(), "roman", true)).toMatchObject({ disabled: true,
      hint: "This map needs no cargo." });
    expect(campaignDepartModel("notAvailable", statusOf(), "roman", false)).toMatchObject({ disabled: true,
      hint: "Locked: complete the previous map first" });
    expect(campaignStartStatus(true)).toBe("");
    expect(campaignStartStatus("Unknown refusal")).toBe("Unknown refusal");
  });
});

const NOW = 5000;
const portOf = (patch: Partial<Parameters<typeof createCampaignWindowPort>[0]> = {}) => {
  const fixture = expeditionHarbourFixture();
  const campaigns = [campaignOf(), campaignOf({ availability: { from: NOW + 1, until: null }, id: "later" })];
  const maps = [mapOf("bay", { unlock: [] }), mapOf("cliffs"), mapOf("draft", { state: "draft" })];
  const start = vi.fn(async () => true as const);
  const port = createCampaignWindowPort({
    now: () => NOW,
    openRepositories: async () => ({
      campaigns: { list: async () => campaigns } as never,
      maps: { list: async ({ campaignId }: { campaignId: string }) =>
        maps.filter(map => map.campaignId === campaignId) } as never
    }),
    operation: () => null,
    readMap: async () => ({ error: "", loaded: { world: {} } as never }),
    simulation: fixture.simulation,
    start,
    ...patch
  });
  return { fixture, maps, port, start };
};

describe("campaign window port (C8)", () => {
  it("offers ready campaigns inside their window with the local lock state for guests", async () => {
    const choices = await portOf().port.load();
    expect(choices.map(choice => choice.campaign.id)).toEqual(["isles"]);
    expect(choices[0]!.maps.map(entry => [entry.map.id, entry.status]))
      .toEqual([["bay", "available"], ["cliffs", "notAvailable"]]);
    expect(await portOf({ openRepositories: async () => null }).port.load()).toEqual([]);
  });

  it("takes the server's lock state and falls back when the server has none", async () => {
    const campaignProgress = vi.fn(async () => ({ completed: false, edges: [{ id: "linear-1", state: "taken" as const }],
      maps: [{ exit: "victory", mapId: "bay", node: "completed" as const, status: "completed" as const },
        { mapId: "cliffs", node: "available" as const, status: "available" as const }] }));
    const online = await portOf({ economy: { campaignProgress } }).port.load();
    expect(campaignProgress).toHaveBeenCalledWith("isles");
    expect(online[0]!.maps.map(entry => entry.status)).toEqual(["completed", "available"]);
    const offline = await portOf({ economy: { campaignProgress: async () => { throw new Error("offline"); } } })
      .port.load();
    expect(offline[0]!.maps.map(entry => entry.status)).toEqual(["available", "notAvailable"]);
  });

  it("checks and starts from a harbour that can launch, and refuses before reading the map file", async () => {
    const { fixture, maps, port, start } = portOf();
    const cargo = { goods: [{ amount: 5, ware: "planks" }], settlers: 0,
      soldiers: [{ amount: 2, type: "shield" as const }] };
    const map = { ...maps[0]!, requiredCargo: cargo };
    expect(port.requirements(map).reason).toBeNull();
    expect(await port.start(map)).toBe(true);
    expect(start).toHaveBeenCalledWith({ loaded: { world: {} }, map, sourceUid: fixture.harbour.uid });
    const heavy = { ...map, requiredCargo: { ...cargo, goods: [{ amount: 100_000, ware: "planks" }] } };
    expect(await port.start(heavy)).toBe(port.requirements(heavy).reason);
    expect(start).toHaveBeenCalledTimes(1);
    const missing = portOf({ readMap: async () => ({ error: "The saved map is gone", loaded: null }) });
    expect(await missing.port.start({ ...missing.maps[0]!, requiredCargo: cargo })).toBe("The saved map is gone");
    expect(missing.start).not.toHaveBeenCalled();
  });
});
