import { describe, expect, it } from "vitest";

import { isTradeShip } from "../src/shared/settlement/settlement-naval-trade";
import {
  CHANNEL_JAM_SECONDS, channelTradeSeconds, createChannelHarbour
} from "./helpers/naval-channel-harbour";
import { SHIP_TICK } from "./helpers/ship-motion-scenarios";

/** Colony return / trade send times (s) that deadlocked the channel harbour before NAV-01. */
const FORMER_JAMS = [[0, 110], [10, 60], [20, 120], [40, 80], [60, 90], [70, 100], [90, 110], [100, 120]] as const;

describe("NAV-01 harbour at the end of a channel", () => {
  it.each(FORMER_JAMS)("colony ship home after %i s, trade ship sent after %i s: no deadlock", (colony, trade) => {
    expect(channelTradeSeconds(colony, trade)).toBeLessThan(CHANNEL_JAM_SECONDS);
  }, 30000);

  it("keeps the visitor beyond the map edge while the idle ship at the berth makes room", () => {
    const { events, fleet, harbour, port } = createChannelHarbour(10);
    // The colony ship is home and idle at the berth by 60 s; then the trade ship is sent.
    for (let tick = 0; tick < 60 / SHIP_TICK; tick++) fleet.update(SHIP_TICK);
    expect(port.send(harbour.uid, { stone: 20 }, "d1", 1)).not.toBeNull();
    let queued = false, enteredWhileBerthHeld = false;
    for (let tick = 0; tick < 400 / SHIP_TICK && !events.includes("loaded d1"); tick++) {
      fleet.update(SHIP_TICK);
      const ships = fleet.saveState().ships, trade = ships.find(isTradeShip);
      const homecoming = ships.find(ship => ship.id === 2)!;
      queued ||= trade?.queuedAt !== undefined;
      const berthHeld = homecoming.phase === "idle" && Math.hypot(homecoming.x - 113.5, homecoming.z - 45.5) < 3;
      enteredWhileBerthHeld ||= berthHeld && trade !== undefined && trade.phase !== "away";
    }
    expect(events).toEqual(["unloaded d1", "loaded d1"]);
    expect(queued).toBe(false);
    expect(enteredWhileBerthHeld).toBe(false);
  }, 30000);
});
