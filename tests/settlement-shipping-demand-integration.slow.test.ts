import { describe, expect, it } from "vitest";

import { navalPassengerFixture as fixture } from "./helpers/naval-passenger-fixture";

describe("ISLAND-06 sea supply integration", () => {
  it("ships a new island's later construction need from a real source harbour and delivers it", () => {
    const { simulation, source } = fixture();
    source.inventory = { planks: 4, stone: 6, hammer: 1, shovel: 1 };
    const point = simulation.seaExpeditionDestinations(source.uid)[0]!;
    expect(simulation.queueSeaExpedition(source.uid, point)).not.toBeNull();
    for (let tick = 0; tick < 12000 && !simulation.buildings().some(building => building.foundedByExpedition);
      tick++) simulation.update(.05);
    const outpost = simulation.buildings().find(building => building.foundedByExpedition)!;
    expect(outpost).toBeDefined();
    for (let tick = 0; tick < 12000 && simulation.saveState().naval.founding.operations.length; tick++)
      simulation.update(.05);
    expect(outpost.construction).toBe(1);
    source.inventory = { ...source.inventory, planks: 20, stone: 20, hammer: 2, shovel: 2 };
    let placed: ReturnType<typeof simulation.placeBuilding> | undefined;
    for (let dz = -7; dz <= 7 && !placed?.ok; dz++) for (let dx = -7; dx <= 7; dx++) {
      const result = simulation.placeBuilding(35, outpost.x + dx, outpost.z + dz, 0);
      if (!result.ok) continue;
      if (!simulation.connectRoads(outpost.access, result.building!.access)) {
        simulation.demolishBuilding(result.building!.uid);
        continue;
      }
      placed = result;
      break;
    }
    expect(placed?.ok, placed?.reason).toBe(true);
    const siteUid = placed!.building!.uid;
    const liveSite = () => simulation.buildings().find(building => building.uid === siteUid)!;
    for (let tick = 0; tick < 20; tick++) simulation.update(.05);
    const created = simulation.seaShippingDemands();
    expect(created.some(demand => demand.destinationUid === outpost.uid && demand.ware === "planks")).toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    let orders = 0;
    const seenOrders = new Set<number>();
    for (let tick = 0; tick < 24000 && liveSite().construction < 1; tick++) {
      simulation.update(.05);
      for (const demand of simulation.seaShippingDemands())
        if (demand.orderId !== undefined && !seenOrders.has(demand.orderId)) {
          seenOrders.add(demand.orderId);
          orders++;
        }
      for (const ship of simulation.ships())
        if (ship.orderId !== undefined && ship.destinationUid === outpost.uid && !seenOrders.has(ship.orderId)) {
          seenOrders.add(ship.orderId);
          orders++;
        }
    }
    expect(liveSite().construction).toBe(1);
    expect(orders).toBeGreaterThan(0);
    expect(seenOrders.size).toBeLessThanOrEqual(2);
    const demandLeft = simulation.seaShippingDemands().filter(demand => demand.destinationUid === outpost.uid);
    expect(demandLeft).toEqual([]);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 45000);
});
