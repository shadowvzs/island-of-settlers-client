import { describe, expect, it } from "vitest";

import {
  GARRISON_CAPACITIES, MILITARY_COIN_CAPACITIES, MILITARY_DRINK_LIMIT
} from "../src/shared/balance/military";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import {
  createSettlementMilitary, promoteMilitaryRanks
} from "../src/shared/settlement/settlement-military";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/** Soldiers come only from the Tavern now: fixtures start with stored swordsmen at the HQ. */
const fixture = (typeId = 1, stored = GARRISON_CAPACITIES[typeId] ?? 0,
  stock: Record<string, number> = { sword: 20, shield: 20, beer: 20, wine: 20 }, nation?: "roman" | "viking" |
    "japanese" | "nubian") => {
  const size = 40;
  const world = { seed: 7, cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() } } as unknown as WorldData;
  let connected = true;
  const context: SettlementContext = { options: { world, roads: {
    route: (from, to) => connected ? { points: [{ ...to }], cost: Math.hypot(from.x - to.x, from.z - to.z), length: 10 } : null,
    addRoad: () => true, upgradeRoad: () => true
  } }, buildings: [], actors: [], occupied: new Uint8Array(size ** 2), reservations: new Set(),
    nextActor: 0, nextBuilding: 0, settlers: 20, accumulator: 0, scheduling: 0, playerNation: nation ?? "roman",
    resourceAmounts: new Map(), transfers: [] } as SettlementContext;
  const home = makeBuilding(context, 0, 5.5, 5.5, 0);
  home.construction = 1; home.inventory = { ...stock }; context.buildings.push(home);
  const building = makeBuilding(context, typeId, 14.5, 8.5, 0);
  building.construction = 1; context.buildings.push(building);
  const military = createSettlementMilitary(context, () => 0);
  military.immigrate(Array.from({ length: stored }, () => ({ hp: militaryHealth("shield", 0), rank: 0, type: "shield" as const })));
  const advance = (seconds: number) => {
    for (let step = 0; step < seconds * 20; step++) {
      military.update(0.05);
      for (const actor of context.actors) military.updateActor(actor, 0.05);
    }
  };
  return { context, home, building, military, advance, disconnect: () => { connected = false; } };
};

describe("finite military garrisons", () => {
  it.each([1, 2, 4, 9])("building %i fills its exact classic garrison with stored soldiers", (id) => {
    const { advance, context, home, military } = fixture(id, GARRISON_CAPACITIES[id]! + 2);
    advance(180);
    const capacity = GARRISON_CAPACITIES[id]!;
    expect(military.snapshot()[0]?.stationed).toBe(capacity);
    expect(context.actors.filter((actor) => actor.phase === "garrison" && !actor.visible)).toHaveLength(capacity);
    expect(context.actors.filter((actor) => actor.phase === "militaryReserve")).toHaveLength(2);
    expect(context.settlers).toBe(20);
    for (const ware of ["sword", "shield", "beer"]) expect(home.inventory[ware]).toBe(20);
  });
  it("never recruits: settlers, swords, shields and beer alone do not make a garrison", () => {
    const { advance, context, home, military } = fixture(1, 0);
    advance(120);
    expect(military.soldiers()).toEqual([]); expect(context.actors).toEqual([]);
    expect(context.settlers).toBe(20);
    expect(home.inventory).toEqual({ sword: 20, shield: 20, beer: 20, wine: 20 });
    expect(military.snapshot()[0]?.stationed).toBe(0);
  });
  it("keeps stored soldiers in reserve without a road connection", () => {
    const disconnected = fixture(); disconnected.disconnect(); disconnected.advance(60);
    expect(disconnected.context.actors.every((actor) => actor.phase === "militaryReserve")).toBe(true);
    expect(disconnected.military.snapshot()[0]?.stationed).toBe(0);
  });
  it("promotes exactly one soldier by one rank using exactly one coin and one wine", () => {
    expect(promoteMilitaryRanks([0, 0, 1, 2])).toEqual([1, 0, 1, 2]);
    const { advance, building, military } = fixture(2);
    advance(80); building.input.coins = 1; building.input.wine = 1; advance(6);
    expect(building.input.coins).toBe(0);
    expect(building.input.wine).toBe(0);
    expect(military.snapshot()[0]?.ranks.slice().sort()).toEqual([0, 0, 1]);
    advance(60); expect(military.snapshot()[0]?.ranks.slice().sort()).toEqual([0, 0, 1]);
  });
  it("pauses promotion without consuming either supply when one is missing", () => {
    const { advance, building, military } = fixture(2);
    advance(80);
    building.input.coins = 1; advance(300);
    expect(building.input.coins).toBe(1);
    expect(military.snapshot()[0]?.ranks).toEqual([0, 0, 0]);
    building.input.wine = 1; advance(300);
    expect(building.input.coins).toBe(0);
    expect(building.input.wine).toBe(0);
    expect(military.snapshot()[0]?.ranks.slice().sort()).toEqual([0, 0, 1]);
  });
  it.each(["balanced", "elite"] as const)("persists %s training and spends one coin and one drink for one tier", focus => {
    const { advance, building, military } = fixture(2);
    advance(80);
    const saved = military.saveState();
    saved.soldiers.forEach((soldier, index) => {
      soldier.rank = index === 0 ? 0 : 1;
      soldier.combat!.hp = militaryHealth("shield", soldier.rank) * .5;
    });
    military.restore(saved);
    expect(military.setTrainingFocus(building.uid, focus)).toBe(true);
    military.restore(JSON.parse(JSON.stringify(military.saveState())));
    expect(military.snapshot()[0]?.trainingFocus).toBe(focus);
    building.input.coins = 1; building.input.wine = 1; advance(6);
    expect(building.input.coins).toBe(0);
    expect(building.input.wine).toBe(0);
    expect(military.snapshot()[0]?.ranks).toEqual(focus === "elite" ? [0, 2, 1] : [1, 1, 1]);
    for (const soldier of military.soldiers())
      expect(soldier.combat!.hp / militaryHealth("shield", soldier.rank)).toBeCloseTo(.5);
    advance(30);
    expect(military.snapshot()[0]?.ranks).toEqual(focus === "elite" ? [0, 2, 1] : [1, 1, 1]);
  });
  it("persists the coin-delivery toggle through save and reload", () => {
    const { building, military } = fixture(2);
    expect(military.snapshot()[0]?.coinsAllowed).toBe(true);
    military.setCoinsAllowed(building.uid, false);
    military.restore(JSON.parse(JSON.stringify(military.saveState())));
    expect(military.snapshot()[0]?.coinsAllowed).toBe(false);
    military.setCoinsAllowed(999, true);
    expect(military.snapshot()[0]?.coinsAllowed).toBe(false);
  });
  it("defaults old saves to Balanced and never promotes veterans", () => {
    expect(promoteMilitaryRanks([2, 2])).toEqual([2, 2]);
    expect(promoteMilitaryRanks([0, 0, 1, 2], "elite")).toEqual([0, 0, 2, 2]);
    const { military } = fixture(2);
    military.restore({ ...military.saveState(), trainingFocus: undefined });
    expect(military.snapshot()[0]?.trainingFocus).toBe("balanced");
  });
  it("caps coin and drink demand, supports disabling coin deliveries and stops at veteran rank two", () => {
    const { advance, building, military } = fixture(4);
    advance(150);
    const snapshot = military.snapshot()[0]!;
    expect(snapshot).toMatchObject({
      coinCapacity: 6, coinIncoming: 0, coinStock: 0, coinsAllowed: true,
      drinkCapacity: MILITARY_DRINK_LIMIT, drinkIncoming: 0, drinkStock: 0, drinkWare: "wine"
    });
    expect(military.coinDemand(building.uid)).toBe(MILITARY_COIN_CAPACITIES[4]);
    expect(military.drinkDemand(building.uid)).toBe(MILITARY_DRINK_LIMIT);
    building.input.coins = 1; building.incoming.coins = 2;
    expect(military.coinDemand(building.uid)).toBe(3);
    building.input.coins = 5; building.incoming.coins = 1;
    expect(military.coinDemand(building.uid)).toBe(0);
    military.setCoinsAllowed(building.uid, true);
    military.setCoinsAllowed(building.uid, false);
    military.setCoinsAllowed(building.uid, true);
    expect(military.coinDemand(building.uid)).toBe(0);
    building.input.coins = 1; building.incoming.coins = 0;
    building.input.wine = 1; building.incoming.wine = 1;
    expect(military.drinkDemand(building.uid)).toBe(1);
    military.setCoinsAllowed(building.uid, false);
    expect(military.coinDemand(building.uid)).toBe(0);
    expect(military.drinkDemand(building.uid)).toBe(1);
    advance(6); expect(building.input.coins).toBe(0); expect(building.input.wine).toBe(0);
    building.input.coins = 100; building.input.wine = 100; advance(180);
    expect(military.snapshot()[0]?.ranks.every((rank) => rank === 2)).toBe(true);
    expect(military.drinkDemand(building.uid)).toBe(0);
    const remaining = { ...building.input }; advance(60);
    expect(building.input.coins).toBe(remaining.coins);
    expect(building.input.wine).toBe(remaining.wine);
  });
  it("resumes a saved training timer once without charging again after reload", () => {
    const { advance, building, military } = fixture(2);
    advance(80);
    building.input.coins = 2; building.input.wine = 2;
    advance(1);
    military.restore(JSON.parse(JSON.stringify(military.saveState())));
    advance(4.5);
    expect(building.input.coins).toBe(1);
    expect(building.input.wine).toBe(1);
    expect(military.snapshot()[0]?.ranks.slice().sort()).toEqual([0, 0, 1]);
    military.restore(JSON.parse(JSON.stringify(military.saveState())));
    advance(1);
    expect(building.input.coins).toBe(1);
    expect(building.input.wine).toBe(1);
  });
  it("groups physically inside soldiers by type and rank for the building window", () => {
    const { advance, building, military } = fixture(2);
    advance(80); building.input.coins = 1; building.input.wine = 1; advance(6);
    expect(military.snapshot()[0]?.stationedByRank).toEqual({
      archer: [0, 0, 0], heavy: [0, 0, 0], shield: [2, 1, 0]
    });
  });
  it.each([
    ["roman", "wine"], ["viking", "mead"], ["japanese", "sake"], ["nubian", "toddy"]
  ] as const)("demands the %s national drink %s instead of beer", (nation, drink) => {
    const { advance, building, military } = fixture(2, 2, undefined, nation);
    advance(80);
    expect(military.snapshot()[0]?.drinkWare).toBe(drink);
    expect(military.drinkDemand(building.uid)).toBe(MILITARY_DRINK_LIMIT);
    building.input[drink] = 1;
    expect(military.drinkDemand(building.uid)).toBe(MILITARY_DRINK_LIMIT - 1);
  });
  it("returns surplus as finite reserve soldiers and redeploys their identity without recruiting again", () => {
    const { advance, building, context, home, military } = fixture(1);
    advance(80); building.input.coins = 1; building.input.wine = 1; advance(6);
    const identities = context.actors.map((actor) => actor.uid);
    expect(identities).toHaveLength(2);
    const population = context.settlers, equipment = { ...home.inventory };
    // A building that claimed territory keeps one soldier, so a zero target leaves one stationed.
    military.setTarget(building.uid, 0); advance(60);
    expect(military.snapshot()[0]?.stationed).toBe(1);
    expect(context.actors.map((actor) => actor.phase).sort()).toEqual(["garrison", "militaryReserve"]);
    expect(context.settlers).toBe(population);
    military.setTarget(building.uid, 2); advance(60);
    expect(military.snapshot()[0]?.stationed).toBe(2);
    expect(context.actors.map((actor) => actor.uid)).toEqual(identities);
    expect(home.inventory).toEqual(equipment);
    expect(military.snapshot()[0]?.ranks.slice().sort()).toEqual([0, 1]);
  });
});
