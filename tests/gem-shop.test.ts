import { BUILDING_MATERIAL_ORDER } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { GEM_SHOP_OFFER_LIST, gemShopOffers, grantGems, purchaseGemOffer } from "../src/shared/progression/gem-shop";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { addToHome } from "../src/shared/settlement/colony-economy";
import { getProductionRule } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { TAVERN_RECIPES } from "../src/shared/settlement/tavern-rules";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const withGems = (gems: number) => ({ ...createPlayerProgress(7), gems });

const islandSimulation = () => {
  const size = 32;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8.5, z: 8.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: {
      count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(), z: new Float32Array()
    }
  } as unknown as WorldData;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialStock: {}, canWorkerEnterPlot: () => true });
  return simulation;
};

describe("gem shop", () => {
  it("sells 100 of every construction material and food, and coins, in the Resources category", () => {
    const wares = gemShopOffers("resources").map(offer => [offer.ware, offer.amount]);
    expect(wares).toEqual([
      ...BUILDING_MATERIAL_ORDER.map(ware => [ware, 100]),
      ["fish", 100], ["meat", 100], ["bread", 100], ["coins", 500]
    ]);
    expect(GEM_SHOP_OFFER_LIST.every(offer => offer.price > 0)).toBe(true);
  });

  it("delivers advanced construction materials to home storage for gems", () => {
    const simulation = islandSimulation();
    const session = createPlayerSession({ now: Date.now, initial: withGems(80), seed: 7 });
    session.bind(simulation);
    for (const ware of ["hardwoodLogs", "hardwoodPlanks", "marble"]) {
      expect(session.buyGemOffer(`${ware}-100`)).toBe(true);
      expect(simulation.headquarters.inventory[ware]).toBe(100);
    }
    expect(session.progress().gems).toBe(0);
  });

  it("sells every implemented Tavern recruiting ingredient in the Military category", () => {
    const military = gemShopOffers("military");
    const ingredients = new Set(Object.values(TAVERN_RECIPES).flatMap(recipe => Object.keys(recipe)));
    expect(new Set(military.map(offer => offer.ware))).toEqual(ingredients);
    expect(military.map(offer => [offer.id, offer.price])).toEqual([["sword-10", 15], ["shield-10", 15],
      ["axe-10", 15], ["bow-10", 15], ["armor-10", 15], ["beer-25", 10]]);
    expect(GEM_SHOP_OFFER_LIST.some(offer => offer.ware === "horse")).toBe(false);
    expect(new Set(GEM_SHOP_OFFER_LIST.map(offer => offer.id)).size).toBe(GEM_SHOP_OFFER_LIST.length);
  });

  it("sells every Metalworker tool and delivers each bundle for its gem price", () => {
    const tools = gemShopOffers("tools");
    expect(new Set(tools.map(offer => offer.ware))).toEqual(new Set(getProductionRule(25)!.outputs));
    const simulation = islandSimulation();
    const session = createPlayerSession({ now: Date.now, initial: withGems(tools.length * 15), seed: 7 });
    session.bind(simulation);
    for (const offer of tools) {
      expect(offer.amount).toBe(10);
      expect(offer.price).toBe(15);
      expect(session.buyGemOffer(offer.id)).toBe(true);
      expect(simulation.headquarters.inventory[offer.ware]).toBe(10);
    }
    expect(session.progress().gems).toBe(0);
    expect(session.buyGemOffer("shovel-10")).toBe("Needs 15 more gems");
    expect(simulation.headquarters.inventory.shovel).toBe(10);
  });

  it("prices a recruit's kit above its raw coin value", () => {
    const unitPrice = (ware: string) => {
      const offer = GEM_SHOP_OFFER_LIST.find(entry => entry.ware === ware)!;
      return offer.price / offer.amount;
    };
    const kit = (recipe: Readonly<Record<string, number>>) =>
      Object.entries(recipe).reduce((sum, [ware, count]) => sum + unitPrice(ware) * count, 0);
    expect(kit(TAVERN_RECIPES.shield)).toBeCloseTo(4.9);
    expect(unitPrice("sword")).toBeGreaterThan(unitPrice("coins"));
  });

  it("deducts the price and returns the goods", () => {
    const purchase = purchaseGemOffer(withGems(40), "planks-100");
    expect(purchase).toEqual({ goods: { planks: 100 }, ok: true, progress: withGems(25) });
  });

  it("refuses when gems are short or the offer is unknown", () => {
    expect(purchaseGemOffer(withGems(99), "coins-500")).toEqual({ ok: false, reason: "Needs 1 more gems" });
    expect(purchaseGemOffer(withGems(999), "gold-1")).toMatchObject({ ok: false });
  });

  it("grants whole, non-negative gems", () => {
    expect(grantGems(withGems(5), 500).gems).toBe(505);
    expect(grantGems(withGems(5), -20).gems).toBe(5);
  });

  it("stores purchases in the home storage and keeps the gems when refused", () => {
    const hq = { construction: 1, inventory: { logs: 3 } as Record<string, number>, typeId: 0 };
    const simulation = {
      buildings: () => [],
      playerNation: () => "roman",
      home: () => undefined,
      islandRole: () => "home",
      deliverHome: (goods: Record<string, number>) => addToHome([hq], goods),
      setTalentRanks: () => true
    } as unknown as SettlementSimulation;
    const session = createPlayerSession({ initial: withGems(30), seed: 7, now: () => Date.UTC(2026, 9, 12) });
    expect(session.buyGemOffer("logs-100")).toBe("No storage or insufficient island storage capacity for these goods");
    expect(session.progress().gems).toBe(30);
    session.bind(simulation);
    expect(session.buyGemOffer("logs-100")).toBe(true);
    expect(hq.inventory.logs).toBe(103);
    expect(session.progress().gems).toBe(20);
    expect(session.buyGemOffer("bread-100")).toBe("Needs 5 more gems");
    expect(hq.inventory.bread).toBeUndefined();
    session.grantGems(500);
    expect(session.progress().gems).toBe(520);
  });

  it("refuses a full per-ware pool without spending gems or partially adding goods", () => {
    const simulation = islandSimulation();
    simulation.headquarters.inventory.logs = 950;
    const session = createPlayerSession({ initial: withGems(30), seed: 7, now: () => Date.UTC(2026, 9, 12) });
    session.bind(simulation);
    expect(session.buyGemOffer("logs-100")).toMatch(/capacity/);
    expect(session.progress().gems).toBe(30);
    expect(simulation.headquarters.inventory.logs).toBe(950);
  });

  it("delivers military goods but no longer sells or creates civilian horses", () => {
    const simulation = islandSimulation();
    const session = createPlayerSession({ initial: withGems(60), seed: 7, now: () => Date.UTC(2026, 9, 12) });
    session.bind(simulation);
    expect(session.buyGemOffer("sword-10")).toBe(true);
    expect(session.buyGemOffer("horse-5")).toBe("This offer is not available");
    const hq = simulation.headquarters;
    expect(hq.inventory).toMatchObject({ sword: 10 });
    expect(hq.inventory.horse ?? 0).toBe(0);
    expect(simulation.frames().filter(actor => actor.job === "Mount")).toHaveLength(0);
    expect(session.progress().gems).toBe(45);
  });
});
