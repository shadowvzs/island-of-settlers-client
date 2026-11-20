import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import {
  getHostileGarrisonRows, getHostileTooltipView, getTooltipCorner, isHostileBuilding
} from "../src/app/settlement/hostile-building-tooltip-helpers";
import { residenceSummary } from "../src/app/settlement/residence-summary";
import { BuildingDetails } from "../src/app/settlement-ui/building-details/building-details";
import { getProductionWares } from "../src/app/settlement-ui/building-details/production-helpers";
import {
  formatResidencePeriod, getResidenceView
} from "../src/app/settlement-ui/building-details/residence-helpers";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import type { SettlementBuildingSummary } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { NEUTRAL_TALENT_MODIFIERS } from "../src/shared/progression/talents";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { renderWithI18n } from "./helpers/render-with-i18n";

const building = (fields: Partial<SettlementBuildingSummary> & { type: number }): SettlementBuildingSummary =>
  ({ completed: true, id: "7", ...fields });
const render = (subject: SettlementBuildingSummary, nation = "roman") => {
  const store = createSettlementUiStore();
  store.update({ buildings: [subject], focusedBuilding: subject.id, playerNation: nation });
  const visibility = createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true });
  return renderWithI18n(createElement(BuildingDetails, { options: {} as never, store, visibility }));
};

describe("production wares row", () => {
  it("puts every input in one bubble and every output in another, joined by an arrow", () => {
    const markup = render(building({ input: { logs: 4 }, output: { planks: 2 }, type: 33 }));
    expect(markup).toContain('<section aria-label="Production wares" class="settlement-ui__ware-flow">');
    expect(markup).toContain('aria-label="Input wares" class="settlement-ui__ware-group" role="group"');
    expect(markup).toContain('aria-label="Produced wares" class="settlement-ui__ware-group" role="group"');
    expect(markup).toContain('class="settlement-ui__ware-flow-arrow"');
    expect(markup).toContain('data-count="4" data-ware="logs"');
  });

  it("reserves the work bar line of a producer while it reports no progress", () => {
    expect(render(building({ input: {}, output: {}, type: 33 })))
      .toContain('<div class="settlement-ui__work-progress-slot settlement-ui__work-progress-slot--reserved"></div>');
    expect(getProductionWares(building({ input: {}, type: 33 }), false)).toMatchObject({
      input: { cells: [{ count: "0", ware: "logs" }] }, output: null, showArrow: false
    });
    expect(getProductionWares(building({ type: 33 }), false)).toEqual(
      getProductionWares(building({ input: {}, type: 33 }), false));
  });
});

describe("configured production display", () => {
  it("renders zero buffers even before input and output snapshots exist", () => {
    const markup = render(building({ type: 33 }));
    expect(markup).toContain('data-count="0" data-ware="logs"');
    expect(markup).toContain('data-count="0" data-ware="planks"');
    expect(markup).not.toContain(">Empty<");
  });

  it("uses the current nation recipe rather than the Roman default", () => {
    const wares = getProductionWares(building({ type: 6 }), true, "japanese");
    expect(wares?.input?.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: "0", ware: "rice" }),
      expect.objectContaining({ count: "0", ware: "water" })
    ]));
    expect(wares?.output?.cells).toMatchObject([{ count: "0", ware: "sake" }]);
    const markup = render(building({ type: 6 }), "japanese");
    expect(markup).toContain('data-count="0" data-ware="sake"');
    expect(markup).not.toContain('data-ware="wine"');
  });

  it("shows selected upgraded recipes and retained positive transition stocks", () => {
    const wares = getProductionWares(building({ input: { logs: 2 }, output: { planks: 3 },
      selectedOutput: "hardwoodPlanks", type: 33, workshopUpgrade: { level: 1 } }));
    expect(wares?.input?.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: "0", ware: "hardwoodLogs" }),
      expect.objectContaining({ count: "2", ware: "logs" })
    ]));
    expect(wares?.output?.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: "0", ware: "hardwoodPlanks" }),
      expect.objectContaining({ count: "3", ware: "planks" })
    ]));
  });

  it("narrows a selected workshop output while Random tools shows one composition", () => {
    const selected = getProductionWares(building({ selectedOutput: "spyglass", type: 25 }));
    expect(selected?.output?.cells).toMatchObject([{ count: "0", ware: "spyglass" }]);
    const mixed = getProductionWares(building({ type: 25 }));
    expect(mixed?.output?.cells).toMatchObject([{ count: "0", ware: "randomTools" }]);
    expect(mixed?.output?.randomTools).toEqual(["axe", "saw", "pickaxe"]);
  });

  it("keeps nonware product controls without inventing product quantities", () => {
    const handcart = getProductionWares(building({ sawmillMode: "handcart", type: 33 }));
    expect(handcart?.input?.cells).toMatchObject([{ count: "0", ware: "logs" }]);
    expect(handcart?.output).toBeNull();
    expect(getProductionWares(building({ shipyardMode: "ships", type: 36 }))?.output).toBeNull();
    expect(getProductionWares(building({ output: { boat: 1 }, shipyardMode: "ships", type: 36 }))
      ?.output?.cells).toMatchObject([{ count: "1", ware: "boat" }]);
  });

  it("renders natural sources without a ware quantity and suppresses service bubbles", () => {
    const markup = render(building({ type: 20 }));
    expect(markup).toContain('data-production-resource="Seedlings"');
    expect(markup).not.toContain("data-count=");
    expect(markup).not.toContain("Produced wares");
    for (const type of [1, 2, 4, 9, 14, 40]) {
      expect(getProductionWares(building({ input: { bows: 1 }, output: { planks: 1 }, type }))).toBeNull();
    }
  });
});

describe("residence details", () => {
  const residence = { growthSeconds: 180, home: "headquarters" as const, limitBonus: 45, talentAdjusted: false };

  it("shows the limit bonus and settler period instead of ware sections", () => {
    const markup = render(building({ input: {}, output: {}, residence, type: 59 }));
    expect(markup).toContain('<section aria-label="Residence" class="settlement-ui__residence">');
    expect(markup).toContain("<dd>+45</dd>");
    expect(markup).toContain("<dd>1 every 3 min</dd>");
    expect(markup).not.toContain("Input wares");
  });

  it("formats periods and notes talent bonuses", () => {
    expect(formatResidencePeriod(150)).toBe("2 min 30 s");
    expect(formatResidencePeriod(45)).toBe("45 s");
    expect(getResidenceView({ ...residence, home: "harbour", talentAdjusted: true }).note)
      .toContain("born at the colony harbour");
    expect(getResidenceView({ ...residence, talentAdjusted: true }).note).toContain("talent bonuses are included");
  });

  it("derives talent-adjusted values from the balance for own completed residences only", () => {
    const big = { construction: 1, typeId: 59, workshopUpgrade: { level: 1 } } as SettlementBuilding;
    const simulation = (populationLimit: number, settlerGrowthSpeed: number) => ({
      home: () => undefined,
      talentModifiers: () => ({ ...NEUTRAL_TALENT_MODIFIERS, populationLimit, settlerGrowthSpeed })
    });
    expect(residenceSummary(simulation(0, 0), big)).toEqual({
      growthSeconds: 180, home: "headquarters", limitBonus: 50, talentAdjusted: false
    });
    expect(residenceSummary(simulation(.1, .5), big)).toMatchObject({ growthSeconds: 120, limitBonus: 55 });
    expect(residenceSummary(simulation(0, 0), { ...big, militaryFaction: 1 })).toBeUndefined();
  });
});

describe("hostile building tooltip", () => {
  const soldier = (type: "archer" | "shield", rank: number, building = 5, stationed = true): SettlementSoldier =>
    ({ actor: 1, building, combat: { type } as SettlementSoldier["combat"], rank, stationed });

  it("counts stationed soldiers per type and tier", () => {
    const rows = getHostileGarrisonRows([soldier("archer", 0), soldier("shield", 0), soldier("shield", 2),
      soldier("shield", 2), soldier("shield", 2, 5, false), soldier("shield", 0, 6)], 5, "roman");
    expect(rows).toEqual([
      { count: 2, label: "Swordsmen · Tier 3" }, { count: 1, label: "Swordsmen · Tier 1" },
      { count: 1, label: "Archers · Tier 1" }
    ]);
    expect(getHostileTooltipView("Guard house", []).empty).toBe("No soldiers inside");
    expect(isHostileBuilding({ militaryFaction: 0 })).toBe(false);
    expect(isHostileBuilding({ militaryFaction: 2 })).toBe(true);
  });

  it("centres the tooltip above its anchor and keeps it on screen", () => {
    const size = { height: 40, width: 100 }, bounds = { height: 600, width: 400 };
    expect(getTooltipCorner({ x: 200, y: 300 }, size, bounds)).toEqual({ x: 150, y: 260 });
    expect(getTooltipCorner({ x: 10, y: 10 }, size, bounds)).toEqual({ x: 8, y: 8 });
    expect(getTooltipCorner({ x: 399, y: 300 }, size, bounds)).toEqual({ x: 292, y: 260 });
  });
});
