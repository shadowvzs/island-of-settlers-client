import { describe, expect, it } from "vitest";

import { TERRITORY_RADII } from "../src/shared/balance/territory";
import {
  ownsTerritoryPoint, resetTerritoryCache, settlementTerritory, territoryPlacementReason
} from "../src/shared/settlement/settlement-territory";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";

const SIZE = 200;
const ENEMY = 2;

const world = () => ({
  cellsX: SIZE, cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10)
}) as unknown as WorldData;

const site = (uid: number, typeId: number, x: number, z: number, militaryFaction?: number) =>
  ({ construction: 1, depth: 2, typeId, uid, width: 2, x, z, access: { x, z: z + 2 }, militaryFaction }) as
    unknown as SettlementBuilding;

const island = () => {
  const playerHome = site(1, 0, 40, 40);
  const enemyHome = site(2, 0, 150, 150, ENEMY);
  const enemyTower = site(3, 1, 150, 110, ENEMY);
  const context = {
    actors: [{ building: enemyTower.uid, job: "Soldier", phase: "garrison" }],
    buildings: [playerHome, enemyHome, enemyTower],
    options: { world: world() }
  } as unknown as SettlementContext;
  return { context, enemyHome, enemyTower, playerHome };
};

/** EAI1b step b3: territory per owner; faction 0 keeps its cache, its signature and its saved claim marks. */
describe("territory per owner", () => {
  it("claims land for each owner from its own headquarters and stationed sites only", () => {
    const { context, enemyTower } = island();
    expect(settlementTerritory(context).sources.map(source => source.uid)).toEqual([1]);
    expect(settlementTerritory(context, ENEMY).sources.map(source => source.uid)).toEqual([2, 3]);
    expect(settlementTerritory(context, 5).sources).toEqual([]);
    expect(ownsTerritoryPoint(context, { x: 40.5, z: 40.5 })).toBe(true);
    expect(ownsTerritoryPoint(context, { x: 40.5, z: 40.5 }, ENEMY)).toBe(false);
    expect(ownsTerritoryPoint(context, { x: 150.5, z: 150.5 }, ENEMY)).toBe(true);
    expect(TERRITORY_RADII[enemyTower.typeId]).toBeDefined();
    // Asking for another owner's territory never writes the saved claim mark.
    expect(enemyTower.territoryClaimed).toBeUndefined();
  });

  it("caches each owner separately and keeps the player's snapshot", () => {
    const { context } = island();
    const player = settlementTerritory(context);
    const enemy = settlementTerritory(context, ENEMY);
    expect(settlementTerritory(context)).toBe(player);
    expect(settlementTerritory(context, ENEMY)).toBe(enemy);
    expect(player.revision).toBe(1);
    expect(enemy.revision).toBe(1);
    resetTerritoryCache(context);
    expect(settlementTerritory(context, ENEMY)).not.toBe(enemy);
  });

  it("checks a plot against its owner's territory and bootstraps an owner without a home", () => {
    const { context, enemyHome } = island();
    const nearEnemy = site(9, 4, 150, 140);
    expect(territoryPlacementReason(context, nearEnemy)).toMatch(/territory/);
    expect(territoryPlacementReason(context, nearEnemy, ENEMY)).toBeNull();
    context.buildings.splice(context.buildings.indexOf(enemyHome), 1);
    expect(territoryPlacementReason(context, site(10, 4, 20, 180), ENEMY)).toBeNull();
  });
});
