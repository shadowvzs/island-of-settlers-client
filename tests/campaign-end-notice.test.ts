import { describe, expect, it } from "vitest";

import type { PreferenceArea } from "../src/app/preferences/registry";
import {
  announceCampaignEndNotice, campaignEndNoticeLines, campaignEndNoticeOf, keepCampaignEndNotice, takeCampaignEndNotice
} from "../src/app/settlement/campaign-end-notice";
import { type CampaignRunState, createCampaignRunState } from "../src/shared/campaign/campaign-run";

/** BR4: the path facts of a stored campaign attempt end, kept over the reload and told once at home. */
const runOf = (fields: Partial<CampaignRunState> = {}): CampaignRunState =>
  ({ ...createCampaignRunState({ attempt: 1, campaignId: "paths", mapId: "harbour" }, { attemptId: "a-1" }),
    ...fields });
const replay = runOf({ mapStatus: "completed" });
const areaOf = (): PreferenceArea & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }, values };
};
const RECORDS = {
  campaign: { id: "paths", name: { en: "The Paths", hu: "Az utak" } },
  map: { exits: [{ id: "exit-1", name: { en: "Spare the village", hu: "Kíméld meg a falut" } }] }
};

describe("campaign end notice (BR4)", () => {
  it("says something only when the path was kept, chosen or an ending was reached", () => {
    expect(campaignEndNoticeOf(replay, { campaignCompleted: false, exit: "exit-1", pathExit: "victory" }))
      .toMatchObject({ completed: false, pathChosen: false, pathExit: "victory", pathKept: true });
    expect(campaignEndNoticeOf(runOf(), { campaignCompleted: false, exit: "exit-1", pathExit: "exit-1" }))
      .toMatchObject({ pathChosen: true, pathKept: false });
    expect(campaignEndNoticeOf(runOf(), { campaignCompleted: true, exit: "victory", pathExit: "victory" }))
      .toMatchObject({ completed: true, pathChosen: false, pathKept: false });
    expect(campaignEndNoticeOf(runOf(), { campaignCompleted: false })).toBeNull();
    expect(campaignEndNoticeOf(runOf(), { campaignCompleted: false, exit: "victory", pathExit: "victory" }))
      .toBeNull();
    expect(campaignEndNoticeOf(replay, { campaignCompleted: true, exit: "exit-1", pathExit: "exit-1" })).toBeNull();
  });

  it("keeps the notice over the reload and gives it out once", () => {
    const area = areaOf();
    keepCampaignEndNotice(replay, { campaignCompleted: false, exit: "exit-1", pathExit: "victory" }, area);
    expect(takeCampaignEndNotice(area)).toMatchObject({ campaignId: "paths", mapId: "harbour", pathKept: true });
    expect(takeCampaignEndNotice(area)).toBeNull();
    keepCampaignEndNotice(replay, { campaignCompleted: false, exit: "victory", pathExit: "victory" }, area);
    expect(area.values.size).toBe(0);
    area.setItem("island-of-settlers.campaign-end-notice", "{\"campaignId\":3}");
    expect(takeCampaignEndNotice(area)).toBeNull();
  });

  it("names the exit and the campaign, the implicit exit as Victory", () => {
    const kept = campaignEndNoticeOf(replay, { campaignCompleted: false, exit: "victory", pathExit: "exit-1" })!;
    expect(campaignEndNoticeLines(kept, RECORDS)).toEqual(["Your campaign path stays: Spare the village"]);
    const ended = campaignEndNoticeOf(runOf(), { campaignCompleted: true, exit: "exit-1", pathExit: "exit-1" })!;
    expect(campaignEndNoticeLines(ended, RECORDS))
      .toEqual(["Your campaign path: Spare the village", "Campaign completed: The Paths"]);
    const plain = campaignEndNoticeOf(replay, { campaignCompleted: false, exit: "exit-1", pathExit: "victory" })!;
    expect(campaignEndNoticeLines(plain, {})).toEqual(["Your campaign path stays: Victory"]);
  });

  it("tells the kept notice at home with names from the campaign records", async () => {
    const area = areaOf(), lines: string[] = [];
    keepCampaignEndNotice(runOf(), { campaignCompleted: true, exit: "exit-1", pathExit: "exit-1" }, area);
    await announceCampaignEndNotice({ area, notify: line => lines.push(line), openRepositories: async () => ({
      campaigns: { list: async () => [RECORDS.campaign] } as never,
      maps: { list: async () => [{ ...RECORDS.map, id: "harbour" }] } as never
    }) });
    expect(lines).toEqual(["Your campaign path: Spare the village", "Campaign completed: The Paths"]);
    await announceCampaignEndNotice({ area, notify: line => lines.push(line), openRepositories: async () => null });
    expect(lines).toHaveLength(2);
  });
});
