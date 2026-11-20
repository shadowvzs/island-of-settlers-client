import { describe, expect, it } from "vitest";

import {
  currentTalentDraft, emptyTalentDraft, getTalentWindowModel, mergeTalentDraft, selectTalentPlayer, type TalentPlayer
} from "../src/app/settlement-ui/talents/helpers";

const player = (fields: Partial<TalentPlayer> = {}): TalentPlayer =>
  ({ gems: 0, level: 9, nation: "roman", talents: {}, ...fields });
const card = (model: ReturnType<typeof getTalentWindowModel>, id: string) =>
  model.columns.flatMap(column => column.tiers.flatMap(tier => tier.cards)).find(entry => entry.id === id)!;
const tooltipTexts = (model: ReturnType<typeof getTalentWindowModel>, id: string) =>
  card(model, id).tooltip.map(line => line.text);

describe("talents window model", () => {
  it("lays every branch out as four tier rows of 3 / 2 / 2 / 1 cards, top to bottom", () => {
    const model = getTalentWindowModel(player(), {}, false);
    expect(model.columns.map(column => column.label)).toEqual(["Economy", "Logistics & Population", "Military"]);
    for (const column of model.columns) {
      expect(column.tiers.map(tier => tier.label)).toEqual(["Tier 1", "Tier 2", "Tier 3", "Tier 4"]);
      expect(column.tiers.map(tier => tier.cards.length)).toEqual([3, 2, 2, 1]);
    }
    expect(model.pointsText).toBe("0 of 9 points spent");
  });
  it("shows a level-gated talent locked, with the level it needs and the player's level", () => {
    const model = getTalentWindowModel(player(), {}, false);
    const field = card(model, "fieldGrowth");
    expect(field).toMatchObject({ canRaise: false, lockText: "Lv 12", locked: true });
    expect(field.className).toContain("talents__card--locked");
    expect(field.tooltip.at(-1)).toEqual({ marked: true, text: "Requires level 12 (you are level 9)" });
    expect(field.actionLabel).toContain("Requires level 12 (you are level 9)");
    expect(card(model, "productionSpeed")).toMatchObject({ canRaise: true, locked: false, lockText: undefined });
    expect(card(model, "colonyProduction").tooltip.at(-1)!.text).toBe("Requires level 40 (you are level 9)");
  });
  it("locks a tier until 4 points are placed in the tier above, and says why", () => {
    const locked = card(getTalentWindowModel(player(), { productionSpeed: 3 }, false), "constructionSpeed");
    expect(locked).toMatchObject({ canRaise: false, lockText: "4 pts", locked: true });
    expect(locked.tooltip.at(-1)).toEqual({ marked: true, text: "Requires 4 points in Economy tier 1 (3 placed)" });
    const open = card(getTalentWindowModel(player(), { productionSpeed: 3, storageCapacity: 1 }, false),
      "constructionSpeed");
    expect(open).toMatchObject({ canRaise: true, locked: false });
  });
  it("describes the current and next rank and what the talent affects, from the data", () => {
    const applied = { productionSpeed: 1 };
    const draft = mergeTalentDraft(applied, { productionSpeed: 3, shipping: 1 });
    const model = getTalentWindowModel(player({ talents: applied }), draft, false);
    const production = card(model, "productionSpeed");
    expect(production.rankText).toBe("3/5");
    expect(production.className).toContain("talents__card--pending");
    expect(tooltipTexts(model, "productionSpeed")).toEqual(["Now (rank 3): +6% production speed",
      "Next rank (4): +8% production speed", "Affects: All production buildings"]);
    expect(tooltipTexts(model, "hunterFisherSpeed")).toEqual(
      ["Next rank (1): +5% hunter and fishery work speed", "Affects: Fishery, Hunter"]);
    expect(tooltipTexts(model, "shipping").slice(0, 2)).toEqual([
      "Now (rank 1): −5% trade, supply and colony voyage time, +5% dock porter speed",
      "Next rank (2): −10% trade, supply and colony voyage time, +10% dock porter speed"]);
    expect(model.applyLabel).toBe("Apply 3 points");
    expect(model.reset).toMatchObject({ disabled: false, label: "Reset pending" });
  });
  it("shows no next rank at the highest rank", () => {
    const maxed = { storageCapacity: 5 };
    const lines = tooltipTexts(getTalentWindowModel(player({ talents: maxed }), maxed, false), "storageCapacity");
    expect(lines[0]).toBe("Now (rank 5): +25% storage capacity (also the trade buy limit)");
    expect(lines.some(line => line.startsWith("Next rank"))).toBe(false);
  });
  it("offers the paid reset after Apply, confirmed in a second step", () => {
    const applied = { productionSpeed: 2 };
    const idle = getTalentWindowModel(player({ gems: 120, talents: applied }), applied, false);
    expect(idle.applyDisabled).toBe(true);
    expect(idle.reset).toMatchObject({ disabled: false, label: "Reset all (100 gems)" });
    const confirming = getTalentWindowModel(player({ gems: 120, talents: applied }), applied, true);
    expect(confirming.reset.label).toBe("Confirm reset: 100 gems");
    expect(getTalentWindowModel(player({ gems: 99, talents: applied }), applied, true).reset.disabled).toBe(true);
    expect(getTalentWindowModel(player(), {}, false).reset.disabled).toBe(true);
  });
  it("keeps applied ranks under a draft and selects the player's talent fields", () => {
    expect(mergeTalentDraft({ productionSpeed: 2 }, { productionSpeed: 1, storageCapacity: 1 }))
      .toEqual({ productionSpeed: 2, storageCapacity: 1 });
    expect(selectTalentPlayer({})).toEqual({ gems: 0, level: 1, nation: "roman", talents: {} });
  });
  it("discards unapplied points when the window is closed and opened again", () => {
    const draft = { confirmingReset: true, opened: 2, points: { productionSpeed: 3 } };
    expect(currentTalentDraft(draft, 2)).toBe(draft);
    expect(currentTalentDraft(draft, 3)).toEqual(emptyTalentDraft(3));
    expect(emptyTalentDraft(3)).toEqual({ confirmingReset: false, opened: 3, points: {} });
  });
});
