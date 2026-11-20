import { ROAD_SPEED } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { ROAD_APPEARANCE } from "../../../src/render-common/road-appearance";
import { ROAD_TIERS } from "../../../src/shared/settlement/road-types";
import { COLONY_RESOURCE_TIERS } from "../../../src/shared/world/colony-resource-tiers";
import { TREE_PROPS } from "../../../src/shared/world/editing/prop-removal";
import { clickGround, hideBuildPanel } from "./natural-ui-helpers";
import { MissingPrerequisite } from "./report";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;

/** UI commands only; fixture gaps are explicit and never filled with grants or direct state writes. */
export const runProgressionCases = async (page: Page, runCase: RunCase) => {
  const pairEvidence = await page.evaluate(({ pairs, treeKinds }) => {
    const world = (window as any).__fullE2E?.world;
    if (!world) return null;
    const pair = pairs.find(entry => entry.tier === world.colonyResourceTier);
    const trees: Record<number, number> = {}, authoredOther: number[] = [];
    for (let id = 0; id < world.props.count; id++) {
      const type = world.props.types[id];
      if (!treeKinds.includes(type)) continue;
      if (world.authoredTreeAges?.[id] !== undefined && type !== pair?.treeKind) { authoredOther.push(id); continue; }
      trees[type] = (trees[type] ?? 0) + 1;
    }
    return { tier: world.colonyResourceTier ?? null, trees, authoredOther,
      deposits: (world.colonyStoneDeposits ?? []).map((entry: any) => ({ ...entry, material: entry.material ?? "marble" })) };
  }, { pairs: [...COLONY_RESOURCE_TIERS], treeKinds: [...TREE_PROPS] });
  for (const pair of COLONY_RESOURCE_TIERS) await runCase(`E2E-03-colony-pair-${pair.tier}`,
    `Tier ${pair.tier}: live ${pair.wood}/${pair.stone} source identity`, async () => {
      if (!pairEvidence || pairEvidence.tier !== pair.tier)
        throw new MissingPrerequisite(`Supply an authentic tier ${pair.tier} colony checkpoint; current island does not prove this pair`);
      assert((pairEvidence.trees[pair.treeKind] ?? 0) > 0, "Selected colony timber is absent");
      assert.deepEqual(Object.keys(pairEvidence.trees).map(Number), [pair.treeKind], "Unmarked natural trees differ from selected resource pair");
      if (!pairEvidence.deposits.some((entry: any) => entry.remaining > 0))
        throw new MissingPrerequisite("No remaining finite stone source; depleted checkpoint cannot prove new quarry work");
      assert(pairEvidence.deposits.every((entry: any) => entry.material === pair.stone), "Colony deposit material differs from selected pair");
      return { ...pairEvidence, scope: "Current source identity only. Authored exceptions are listed; discovery probability, worker harvesting, deliveries and history require separate cases." };
    });

  let edge: { start: { x: number; z: number }; end: { x: number; z: number } } | undefined;
  let ready = true;
  for (const tier of ROAD_TIERS.slice(1)) {
    if (tier === "dirt") continue;
    await runCase(`E2E-05-road-tier-${tier}`, `Sequential finite UI road upgrade to ${tier}`, async () => {
      if (!ready) throw new MissingPrerequisite("Earlier sequential road tier did not pass");
      ready = false;
      const candidate = await page.evaluate(({ edge, tier }) => {
        const sim = (window as any).__settlement.simulation;
        const buildings = sim.buildings();
        const live = (window as any).__settlement;
        const stores = buildings.filter((building: any) => [0, 29, 39].includes(building.typeId) && building.construction === 1 && (building.inventory[tier] ?? 0) > 0);
        const roads = edge ? [edge] : sim.roadSegments().filter((road: any) => road.tier === "dirt" &&
          buildings.every((building: any) => Math.hypot(building.access.x - road.start.x, building.access.z - road.start.z) > 3));
        const road = roads.find((part: any) => sim.planRoad(part.start, part.end, tier) &&
          stores.some((store: any) => live.roads.route(store.access, part.start)));
        const supply = road ? stores.filter((store: any) => live.roads.route(store.access, road.start))
          .reduce((sum: number, store: any) => sum + store.inventory[tier], 0) : 0;
        return road && supply > 0 ? { start: road.start, end: road.end, supply } : null;
      }, { edge, tier });
      if (!candidate) throw new MissingPrerequisite(`Needs a prior-tier public edge and finite ${tier}; no material supplied by runner`);
      await page.evaluate(point => (window as any).__settlement.focusGround(point.x, point.z), candidate.start);
      await page.waitForTimeout(150);
      await page.keyboard.press("Escape");
      if (!await page.getByRole("heading", { name: "Build your settlement", exact: true }).isVisible())
        await page.getByRole("button", { name: "Build", exact: true }).click();
      await page.getByRole("tab", { name: "Roads", exact: true }).click();
      await page.getByRole("button", { name: `${ROAD_APPEARANCE[tier].label} road`, exact: true }).click();
      await hideBuildPanel(page);
      await clickGround(page, candidate.start); await clickGround(page, candidate.end); await page.keyboard.press("Escape");
      const result = await page.evaluate(({ end, start }) => (window as any).__settlement.simulation.roadSegments().find((road: any) => {
        const same = (a: any, b: any) => a.x === b.x && a.z === b.z;
        return (same(road.start, start) && same(road.end, end)) || (same(road.start, end) && same(road.end, start));
      }), candidate);
      assert.equal(result?.tier, tier, "Selected edge did not reach the requested sequential tier");
      edge = { start: candidate.start, end: candidate.end }; ready = true;
      return { edge, result, speed: ROAD_SPEED[tier], finiteStockBefore: candidate.supply,
        scope: "Actual UI tier transition. Exact payment attribution, loaded cart traversal, visuals and reload remain separate obligations." };
    });
  }
};
