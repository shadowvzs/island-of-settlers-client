import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { HANDCART_LOGISTICS } from "../../../src/shared/balance/economy";
import { isMaterialForester, MATERIAL_BUILDING_GROUPS } from "../../../src/shared/settlement/advanced-material-production";
import { MissingPrerequisite } from "./report";

export const isSpecialProductionMode = (typeId: number, mode: string) =>
  typeId === 20 || isMaterialForester(typeId) || ["handcart", "ships", "boats"].includes(mode);

const prerequisites = (page: Page, uid: number, mode: string, cartLimit: number) =>
  page.evaluate(({ cartLimit, cartLogs, foresters, mode, uid }) => {
    const live = (window as any).__settlement, sim = live.simulation;
    const buildings = sim.buildings(), building = buildings.find((b: any) => b.uid === uid);
    const stores = buildings.filter((b: any) => b.construction === 1 && [0, 29, 39].includes(b.typeId));
    const supplies: Record<string, number> = { ...building.input };
    for (const storage of stores) for (const [ware, amount] of Object.entries(storage.inventory))
      supplies[ware] = (supplies[ware] ?? 0) + Number(amount);
    const reasons: string[] = [];
    if (building.typeId === 20 || foresters.includes(building.typeId)) {
      if (!(window as any).__fullE2E?.world || !live.growth)
        reasons.push("World prop and shared growth observations unavailable");
    }
    if (mode === "handcart") {
      if ((supplies.logs ?? 0) < 3 * cartLogs) reasons.push(`Needs ${3 * cartLogs} finite logs for three carts`);
      if (buildings.some((b: any) => b.uid !== uid && b.typeId === 33 && (b.handcartMode || (b.handcarts ?? 0))))
        reasons.push("Other cart yards must be inactive/empty for unambiguous source ownership");
      if (building.handcarts) reasons.push("Preexisting yard carts prevent a fresh crafting baseline");
      if (!live.roads?.stoneRoute) reasons.push("Native paved-route inspection unavailable");
      const hasStoneRoute = (store: any) => Boolean(live.roads?.stoneRoute(building.access, store.access));
      const storage = stores.find((store: any) => cartLimit - sim.handcarts(store.uid) >= 3 && hasStoneRoute(store));
      if (!storage) reasons.push("Needs one storage with three cart slots and a committed paved connection");
      if (stores.some((store: any) => sim.handcarts(store.uid) < cartLimit &&
        live.roads.route(building.access, store.access) && !hasStoneRoute(store)))
        reasons.push("All available receiving storages need paved connections so nearest-storage cart collection can return");
    }
    if (mode === "boats") {
      if ((supplies.planks ?? 0) < 3) reasons.push("Needs three finite planks for three workshop boats");
      const home = buildings.find((b: any) => b.typeId === 0 || b.colonyHome);
      if (!home || home.accepts.boat === false || !live.roads.route(building.access, home.access))
        reasons.push("Needs a connected home accepting workshop boats");
    }
    if (mode === "ships") {
      if ((supplies.planks ?? 0) < 30) reasons.push("Needs thirty finite planks for three ten-step fleet hulls");
      if (buildings.some((b: any) => b.typeId === 36 && b.uid !== uid && sim.shipyardMode(b.uid) === "ships"))
        reasons.push("Other fleet-building yards must be in boats mode for unambiguous launch ownership");
    }
    return { reasons, supplies, status: building.status };
  }, { uid, mode, cartLimit, foresters: MATERIAL_BUILDING_GROUPS.map(group => group.forester), cartLogs: HANDCART_LOGISTICS.cost.logs ?? 4 });

/** Real lifecycle proofs supplement goods production, without issuing game commands or advancing simulation. */
export const observeSpecialProduction = async (page: Page, uid: number, typeId: number, mode: string) => {
  const before = await prerequisites(page, uid, mode, HANDCART_LOGISTICS.storageLimit);
  if (before.reasons.length) throw new MissingPrerequisite(before.reasons.join("; "));
  const seconds = Number(process.env.E2E_SPECIAL_PRODUCTION_SECONDS ?? 1200);
  assert(Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600,
    "Special production deadline must be within [1, 3600] wall seconds");
  await page.evaluate(async ({ mode, typeId, uid }) => {
    const url = "/tools/e2e/full/special-production-observer.ts";
    const { createSpecialProductionObserver } = await import(/* @vite-ignore */ url);
    const full = (window as any).__fullE2E;
    (window as any).__specialProduction = createSpecialProductionObserver({
      world: full?.world, settlement: (window as any).__settlement
    }, uid, typeId, mode);
  }, { uid, typeId, mode });
  const deadline = Date.now() + seconds * 1000;
  let evidence: any;
  try {
    while (Date.now() < deadline) {
      evidence = await page.evaluate(() => (window as any).__specialProduction.read());
      const paidShips = mode !== "ships" || evidence.paidPlanks >= 30;
      if (evidence.completed >= 3 && paidShips)
        return { mode, before, evidence, proof: "Three source-attributed lifecycle completions with actual ownership/maturity receipts",
          scope: "Functional lifecycle evidence only; contextual animation quality, exhaustion/cancellation and exact isolated conservation remain separate assertions" };
      await page.waitForTimeout(500);
    }
  } finally {
    await page.evaluate(() => (window as any).__specialProduction?.stop());
  }
  const after = await prerequisites(page, uid, mode, HANDCART_LOGISTICS.storageLimit);
  if (((typeId === 20 || isMaterialForester(typeId)) && after.status === "Waiting for reachable resource") ||
    (mode === "ships" && after.status.startsWith("No reachable ship work site")))
    throw new MissingPrerequisite(`Working planting/coastal fixture remains unproven: ${after.status}; ` +
      JSON.stringify(evidence));
  throw new Error(`Special production ${typeId}/${mode} did not prove three lifecycle completions in ${seconds}s: ` +
    JSON.stringify({ status: after.status, evidence, remainingSupplies: after.supplies }));
};
