import { ROAD_SPEED } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { CARRIER_WALK_SPEED, HANDCART_LOGISTICS, ROAD_STONE_COST } from "../src/shared/balance/economy";
import { ARMORY_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { ROAD_GRID_STEP, ROAD_TIERS } from "../src/shared/settlement/road-types";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

it.each(ROAD_TIERS)("pays exact sequential road costs and delivers real loaded transport on %s", tier => {
  // An Armory receives (no coal, so it never consumes the iron): since the shared storage pools
  // (6443243c5) a Storehouse shares the HQ pool, so a same-pool transfer is rejected without transport.
  const { building, simulation, total } = workshopUpgradeFixture(ARMORY_TYPE_ID, {
    iron: 3, marble: 200, limestone: 200, basalt: 200, granite: 200
  });
  const home = simulation.headquarters;
  home.handcarts = 1;
  const routeLength = simulation.roadSegments().reduce((sum, segment) => sum +
    Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z), 0);
  const cost = routeLength / ROAD_GRID_STEP * ROAD_STONE_COST;
  for (const next of ROAD_TIERS.slice(1, ROAD_TIERS.indexOf(tier) + 1)) {
    const before = total(next);
    expect(simulation.upgradeRoad(home.access, building.access, next as Exclude<typeof next, "dirt">)).toBe(true);
    expect(total(next)).toBe(before - cost);
    expect(simulation.upgradeRoad(home.access, building.access, next as Exclude<typeof next, "dirt">)).toBe(true);
    expect(total(next)).toBe(before - cost);
  }
  expect(simulation.transferWare(home.uid, building.uid, "iron", 3)).toBe(true);
  let reloaded = false, cartSeen = false, maximumStep = 0;
  for (let tick = 0; tick < 4000; tick++) {
    const before = new Map(simulation.frames().map(actor => [actor.uid, { x: actor.x, z: actor.z }]));
    simulation.update(.05);
    expect(total("iron")).toBe(3);
    for (const actor of simulation.frames()) {
      const previous = before.get(actor.uid);
      const loaded = actor.handcart?.cargo || actor.ware === "iron";
      if (!loaded || !actor.visible || !previous) continue;
      cartSeen ||= Boolean(actor.handcart);
      if (actor.x > 16 && actor.x < 24)
        maximumStep = Math.max(maximumStep, Math.hypot(actor.x - previous.x, actor.z - previous.z));
      if (reloaded || actor.x < 16) continue;
      expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
      reloaded = true;
      break;
    }
    if ((simulation.buildings().find(entry => entry.uid === building.uid)!.input.iron ?? 0) === 3) break;
  }
  expect(reloaded).toBe(true);
  expect(cartSeen).toBe(tier !== "dirt");
  const cartFactor = tier === "dirt" ? 1 : HANDCART_LOGISTICS.speedFactor;
  expect(maximumStep).toBeCloseTo(CARRIER_WALK_SPEED * cartFactor * ROAD_SPEED[tier] * .05, 5);
  const destination = simulation.buildings().find(entry => entry.uid === building.uid)!;
  expect(destination.input.iron).toBe(3);
  expect(destination.incoming.iron ?? 0).toBe(0);
  expect(simulation.population().people - simulation.settlerBirths()).toBe(40);
}, 30000);
