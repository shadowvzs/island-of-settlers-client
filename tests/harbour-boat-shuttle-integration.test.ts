import { describe, expect, it } from "vitest";

import { createSettlementNaval } from "../src/shared/settlement/settlement-naval";
import type { SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

const blockHarbourRoads = (context: SettlementContext, harbours: { access: SettlementPoint }[]) => {
  const original = context.options.roads.route;
  const blocked = new Set(harbours.map(harbour => `${harbour.access.x},${harbour.access.z}`));
  context.options.roads.route = (from, to) =>
    blocked.has(`${from.x},${from.z}`) && blocked.has(`${to.x},${to.z}`) ? null : original(from, to);
};

describe("harbour boat shuttle through the naval controller", () => {
  it("exposes status/save/removal and carries the transfer through the public naval API", () => {
    const sea = createShipSea(), from = sea.harbour(20, 15), to = sea.harbour(44, 15);
    blockHarbourRoads(sea.context, [from, to]);
    from.inventory = { boat: 1, stone: 4 }; from.idleSettlers = 3;
    sea.context.transfers.push({ count: 2, destination: to.uid, source: from.uid, ware: "stone" });
    const naval = createSettlementNaval(sea.context);
    expect(naval.harbourShuttleStatus(from.uid)?.reason).toBe("idle");
    expect(naval.harbourShuttles()).toHaveLength(2);
    for (let time = 0; time < 240; time += SHIP_TICK) naval.update(SHIP_TICK);
    expect(to.inventory.stone).toBe(2);
    expect(naval.harbourShuttles().every(status => status.reason !== "active")).toBe(true);
    expect(naval.saveState().fleet.shuttles?.jobs).toHaveLength(0);
    sea.context.buildings = sea.context.buildings.filter(building => building !== to);
    naval.removeBuilding(to.uid);
    expect(naval.harbourShuttleStatus(from.uid)?.reason).toBe("no-partner");
  });
});
