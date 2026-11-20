import { shipDeckCapacity } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { createNavalFleet, type NavalPassengerHooks } from "../src/shared/settlement/settlement-naval-fleet";
import { createTradeShipPort } from "../src/shared/settlement/settlement-naval-trade";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { wareBoxUnits } from "../src/shared/settlement/ship-cargo-boxes";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { boxes: SHIP_DECK_BOXES } = shipDeckCapacity();

/** Fleet-level trade ships with a recording trade office: each unloads its hold and loads two fish. */
const tradeHarbour = () => {
  const sea = createShipSea(), harbour = sea.harbour(60);
  const events: string[] = [];
  const hooks: NavalPassengerHooks = {
    embark: () => {}, ready: () => true, release: () => {},
    tradeLoaded: delivery => { events.push(`loaded ${delivery}`); },
    tradeShipGone: delivery => { events.push(`gone ${delivery}`); },
    tradeUnloaded: (delivery, _ship, uid) => {
      events.push(`unloaded ${delivery}`);
      expect(uid).toBe(harbour.uid);
      return { fish: 2 };
    },
    visitorLoaded: () => { throw new Error("a trade ship never hands wares to the home island"); }
  };
  const fleet = createNavalFleet(sea.context, sea.sea, hooks);
  return { events, fleet, harbour };
};
const send = (fleet: ReturnType<typeof createNavalFleet>, uid: number, delivery: string, queue: number, cargo: Goods) =>
  fleet.sendVisitor(uid, cargo, [], "trade", [], 0, undefined, { delivery, queue });

describe("trade ship pier queue", () => {
  it("docks one trade ship at a time, in queue order, while the others wait offshore", () => {
    const { events, fleet, harbour } = tradeHarbour();
    // d3 is sent before d2: while d1 holds the pier, the queue number decides who comes in next.
    expect(send(fleet, harbour.uid, "d1", 1, { stone: 4 })).not.toBeNull();
    expect(send(fleet, harbour.uid, "d3", 3, { stone: 4 })).not.toBeNull();
    expect(send(fleet, harbour.uid, "d2", 2, { stone: 4 })).not.toBeNull();
    let maxAtPier = 0;
    for (let tick = 0; tick < 1200 / SHIP_TICK && events.filter(event => event.startsWith("gone")).length < 3; tick++) {
      fleet.update(SHIP_TICK);
      const atPier = fleet.frames().filter(ship => ship.phase === "loading" || ship.phase === "unloading").length;
      maxAtPier = Math.max(maxAtPier, atPier);
    }
    expect(maxAtPier).toBe(1);
    expect(events.filter(event => !event.startsWith("gone"))).toEqual(
      ["unloaded d1", "loaded d1", "unloaded d2", "loaded d2", "unloaded d3", "loaded d3"]);
    expect(events.filter(event => event.startsWith("gone"))).toHaveLength(3);
    expect(fleet.frames()).toEqual([]);
    expect(fleet.snapshot()).toEqual([]);
  }, 60000);
  it("asks an idle ship lying in the way in to make room instead of waiting off the map for good", () => {
    const { events, fleet, harbour } = tradeHarbour();
    // The trade ship waits 30 s beyond the map edge; meanwhile an own ship comes to rest by its way in.
    expect(fleet.sendVisitor(harbour.uid, { stone: 4 }, [], "trade", [], 30, undefined, { delivery: "d1", queue: 1 }))
      .not.toBeNull();
    const entry = fleet.saveState().ships[0]!;
    const idle = fleet.addShip({ x: entry.x - 4, z: entry.z });
    expect(fleet.saveState().ships.find(ship => ship.id === idle)?.phase).toBe("idle");
    for (let tick = 0; tick < 600 / SHIP_TICK && !events.includes("loaded d1"); tick++) fleet.update(SHIP_TICK);
    expect(events).toContain("unloaded d1");
    expect(events).toContain("loaded d1");
  }, 60000);
  it("carries a whole large trade in one ship; its deck and pier time are those of one full hold", () => {
    /** Seconds the ship lies unloading and the most boxes ever shown on its deck. */
    const unloadOf = (cargo: Goods) => {
      const { events, fleet, harbour } = tradeHarbour();
      expect(send(fleet, harbour.uid, "d1", 1, cargo)).not.toBeNull();
      let unloading = 0, deck = 0;
      for (let tick = 0; tick < 900 / SHIP_TICK && !events.includes("loaded d1"); tick++) {
        fleet.update(SHIP_TICK);
        const frame = fleet.frames()[0];
        if (frame?.phase === "unloading") unloading += SHIP_TICK;
        deck = Math.max(deck, frame?.deckBoxes ?? 0);
      }
      expect(events).toContain("loaded d1");
      return { deck, unloading };
    };
    const fullHold = unloadOf({ stone: SHIP_DECK_BOXES * wareBoxUnits("stone") });
    const large = unloadOf({ stone: 2000 });
    expect(large.deck).toBe(SHIP_DECK_BOXES);
    expect(large.unloading).toBeCloseTo(fullHold.unloading, 5);
  }, 60000);
  it("caps a large supply ship's pier time at one full hold; a reward ship keeps its full handling", () => {
    /** Seconds a visitor of `role` lies unloading `cargo`. */
    const unloadSeconds = (role: "reward" | "supply", cargo: Goods) => {
      const { fleet, harbour } = tradeHarbour();
      expect(fleet.sendVisitor(harbour.uid, cargo, [], role)).not.toBeNull();
      let unloading = 0;
      for (let tick = 0; tick < 900 / SHIP_TICK && fleet.frames().length; tick++) {
        fleet.update(SHIP_TICK);
        if (fleet.frames()[0]?.phase === "unloading") unloading += SHIP_TICK;
      }
      expect(fleet.frames()).toEqual([]);
      return unloading;
    };
    const fullHold = { stone: SHIP_DECK_BOXES * wareBoxUnits("stone") }, large = { stone: 2000 };
    expect(unloadSeconds("supply", large)).toBeCloseTo(unloadSeconds("supply", fullHold), 5);
    // Not a logistics visitor: every box is carried (unchanged).
    expect(unloadSeconds("reward", large)).toBeGreaterThan(unloadSeconds("reward", fullHold) + 1);
  }, 60000);
  it("refuses a bare trade visitor and a trade delivery under another role", () => {
    const { fleet, harbour } = tradeHarbour();
    expect(fleet.sendVisitor(harbour.uid, { fish: 1 }, [], "trade")).toBeNull();
    expect(fleet.sendVisitor(harbour.uid, { fish: 1 }, [], "supply", [], 0, undefined, { delivery: "d1", queue: 1 }))
      .toBeNull();
  });

  it("keeps a ship sent ahead of its payment offshore, lets later ships pass, then docks it once ready", () => {
    const { events, fleet, harbour } = tradeHarbour();
    const port = createTradeShipPort(fleet);
    const early = port.send(harbour.uid, { stone: 4 }, "d1", 1, true)!;
    expect(port.send(harbour.uid, { stone: 4 }, "d2", 2)).not.toBeNull();
    const runUntil = (done: () => boolean) => {
      for (let tick = 0; tick < 1200 / SHIP_TICK && !done(); tick++) fleet.update(SHIP_TICK);
    };
    runUntil(() => events.includes("gone d2"));
    // d2 came, unloaded and left while d1 still waited for its payment.
    expect(events).toEqual(["unloaded d2", "loaded d2", "gone d2"]);
    expect(fleet.frames().find(ship => ship.id === early)?.phase).not.toBe("unloading");
    port.ready(early);
    runUntil(() => events.includes("gone d1"));
    expect(events.slice(3)).toEqual(["unloaded d1", "loaded d1", "gone d1"]);
  });
});
