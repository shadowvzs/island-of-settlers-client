import { STARTER_STOCK, starterStockForNation } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createConstructionPlan } from "../src/renderers/three/settlement/construction-plan";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { constructionStockLayout } from "../src/shared/settlement/construction-stock-layout";
import { applyConstructionContact } from "../src/shared/settlement/settlement-construction";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";

it("requires delivered fabric before a tent can finish construction", () => {
  const required = getConstructionCost(17, "indigenous");
  const building = { construction: 0, width: getBuildingDefinition(17).gridFootprint[0], required,
    input: { ...required, cloth: 0 } } as unknown as SettlementBuilding;
  for (let contact = 0; contact < 200 && applyConstructionContact(building); contact++) { /* Build until cloth is needed. */ }
  expect(required.cloth).toBeGreaterThan(0);
  expect(building.construction).toBeLessThan(1);
  expect(building.constructionConsumed?.cloth ?? 0).toBe(0);
  building.input.cloth = required.cloth!;
  for (let contact = 0; contact < 200 && applyConstructionContact(building); contact++) { /* Finish with real input. */ }
  expect(building.construction).toBe(1);
  expect(building.constructionConsumed?.cloth).toBe(required.cloth);
  expect(building.input.cloth).toBe(0);
});

it("keeps fabric production recoverable and supplies only new Indigenous settlements with starter cloth", () => {
  for (const id of [60, 61]) expect(getConstructionCost(id, "indigenous").cloth ?? 0).toBe(0);
  expect(starterStockForNation("indigenous").cloth).toBe(48);
  expect(starterStockForNation("roman")).toEqual(STARTER_STOCK);
  expect(starterStockForNation("chinese")).toEqual(STARTER_STOCK);
  expect(getConstructionCost(0, "indigenous")).toEqual(getConstructionCost(0));
  expect(getConstructionCost(7, "indigenous").cloth).toBeGreaterThan(0);
  for (const id of [1, 2, 4, 9, 14, 40]) expect(getConstructionCost(id, "indigenous").stone).toBe(0);
});

it("renders and locates every textile monument material, including its eleventh cloth pile", () => {
  const cost = getConstructionCost(7, "indigenous");
  expect(Object.values(cost).filter(amount => amount > 0)).toHaveLength(11);
  for (const ware of Object.keys(cost)) for (let slot = 0; slot < Math.min(cost[ware]!, 6); slot++) {
    const layout = constructionStockLayout(cost, ware, slot, 9, 9)!;
    expect(layout, `${ware}/${slot}`).toBeDefined();
    expect([layout.x, layout.z, layout.layer, layout.approach.x, layout.approach.z].every(Number.isFinite)).toBe(true);
    expect(Math.abs(layout.x)).toBeLessThan(4.5);
    expect(Math.abs(layout.z)).toBeLessThan(4.5);
  }
  for (const detailed of [true, false]) {
    const plan = createConstructionPlan(getBuildingDefinition(7), detailed, undefined, undefined, "indigenous");
    plan.update({ construction: .5, inputStock: { cloth: 20 } });
    expect(plan.root.children.some(part => part.userData.constructionWare === "cloth")).toBe(true);
    plan.dispose();
  }
});
