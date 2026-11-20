import { describe, expect, it } from "vitest";

import { MORALE_BROKEN, MORALE_WAVERING } from "../src/shared/balance/morale";
import { ROUTE_EXPANSIONS, ROUTE_WAYPOINTS } from "../src/shared/balance/retreat-route";
import { chooseRallyPoint } from "../src/shared/settlement/commander/commander-rally";
import { createRetreatRouter } from "../src/shared/settlement/commander/commander-retreat-route";
import { addInfluence, createInfluenceMap } from "../src/shared/settlement/military-influence-map";
import { corneredStance } from "../src/shared/settlement/military-targeting";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";

const OWN = 1;
const ENEMY = 0;
const open = () => true;

/** A 96×96-tile field (24×24 influence cells) with enemy strength at `enemies`. */
const fieldWith = (enemies: readonly SettlementPoint[], strength = 4) => {
  const map = createInfluenceMap(96, 96);
  addInfluence(map, OWN, { x: 2, z: 2 }, 0);
  for (const enemy of enemies) addInfluence(map, ENEMY, enemy, strength);
  return { map, router: createRetreatRouter(map) };
};

const copy = (route: ReturnType<ReturnType<typeof createRetreatRouter>["route"]>) => ({
  ...route, waypoints: route.waypoints.map(point => ({ ...point }))
});

describe("A14-3 covered retreat router", () => {
  it("walks straight to the goal on an empty field", () => {
    const { router } = fieldWith([]);
    const route = router.route(OWN, { x: 10, z: 48 }, { x: 70, z: 48 }, open);
    expect(route.reached).toBe(true);
    expect(route.blocked).toBe(false);
    expect(route.waypoints).toEqual([{ x: 70, z: 48 }]);
    expect(route.exposure).toBe(0);
    expect(route.straightExposure).toBe(0);
  });

  it("goes round enemy strength on the straight line, less exposed than the straight way", () => {
    const { router } = fieldWith([{ x: 40, z: 48 }, { x: 42, z: 50 }]);
    const route = router.route(OWN, { x: 22, z: 48 }, { x: 62, z: 48 }, open);
    expect(route.reached).toBe(true);
    expect(route.waypoints.length).toBeGreaterThan(1);
    expect(route.waypoints.length).toBeLessThanOrEqual(ROUTE_WAYPOINTS);
    expect(route.exposure).toBeLessThan(route.straightExposure);
    // The first leg turns off the line through the enemy.
    expect(Math.abs(route.waypoints[0]!.z - 48)).toBeGreaterThan(2);
  });

  it("is deterministic and never expands more than its quota", () => {
    const { router } = fieldWith([{ x: 30, z: 30 }, { x: 50, z: 46 }, { x: 36, z: 60 }]);
    const first = copy(router.route(OWN, { x: 10, z: 10 }, { x: 90, z: 90 }, open));
    const second = copy(router.route(OWN, { x: 10, z: 10 }, { x: 90, z: 90 }, open));
    expect(second).toEqual(first);
    expect(first.expansions).toBeLessThanOrEqual(ROUTE_EXPANSIONS);
  });

  it("ends at the expanded cell nearest the goal when the quota runs out", () => {
    const { router } = fieldWith(
      [{ x: 30, z: 20 }, { x: 30, z: 36 }, { x: 30, z: 52 }, { x: 30, z: 68 }, { x: 30, z: 84 }], 12);
    const start = { x: 10, z: 50 }, goal = { x: 94, z: 50 };
    const route = router.route(OWN, start, goal, open);
    expect(route.reached).toBe(false);
    expect(route.expansions).toBe(ROUTE_EXPANSIONS);
    const end = route.waypoints.at(-1)!;
    expect(Math.hypot(goal.x - end.x, goal.z - end.z)).toBeLessThan(Math.hypot(goal.x - start.x, goal.z - start.z));
  });

  it("reports no way out when no cell beyond its own is clear", () => {
    const { router } = fieldWith([]);
    const start = { x: 50, z: 50 };
    const route = router.route(OWN, start, { x: 90, z: 50 }, point =>
      Math.floor(point.x / 4) === Math.floor(start.x / 4) && Math.floor(point.z / 4) === Math.floor(start.z / 4));
    expect(route.blocked).toBe(true);
    expect(route.waypoints).toEqual([]);
  });

  it("only takes clear cells", () => {
    const { router } = fieldWith([]);
    const wall = (point: SettlementPoint) => !(point.x > 40 && point.x < 48 && point.z < 44);
    const route = router.route(OWN, { x: 22, z: 30 }, { x: 70, z: 30 }, wall);
    expect(route.reached).toBe(true);
    for (const point of route.waypoints) expect(wall(point)).toBe(true);
    expect(route.waypoints[0]!.z).toBeGreaterThan(30);
  });
});

describe("A14-3 rally point", () => {
  const from = { x: 50, z: 50 }, enemy = { x: 40, z: 50 };

  it("takes the first kind with a usable point, the nearest within it", () => {
    const hero: number[] = [], forts = [80, 50, 60, 52], reserve = [56, 50], home = [58, 50];
    expect(chooseRallyPoint(from, enemy, [hero, forts, reserve, home])).toEqual({ x: 60, z: 52 });
    expect(chooseRallyPoint(from, enemy, [[70, 40], forts, reserve, home])).toEqual({ x: 70, z: 40 });
  });

  it("never rallies towards the enemy, too near or beyond the rally radius", () => {
    expect(chooseRallyPoint(from, enemy, [[30, 50], [51, 50], [95, 50]])).toBeUndefined();
    expect(chooseRallyPoint(from, enemy, [[30, 50, 60, 50]])).toEqual({ x: 60, z: 50 });
  });
});

describe("A14-3 cornered rule", () => {
  it("a broken soldier on a retreat strikes back only after its way stayed blocked", () => {
    expect(corneredStance("retreat", { blocked: 2, moraleState: MORALE_BROKEN })).toBe("move");
    expect(corneredStance("retreat", { blocked: 1, moraleState: MORALE_BROKEN })).toBe("retreat");
    expect(corneredStance("retreat", { blocked: 2, moraleState: MORALE_WAVERING })).toBe("retreat");
    expect(corneredStance("guard", { blocked: 2, moraleState: MORALE_BROKEN })).toBe("guard");
  });
});
