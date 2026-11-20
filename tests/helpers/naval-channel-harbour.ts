import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createNavalFleet, type NavalPassengerHooks, type NavalShip
} from "../../src/shared/settlement/settlement-naval-fleet";
import { createTradeShipPort } from "../../src/shared/settlement/settlement-naval-trade";
import { createShipSeaWorld, SHIP_TICK } from "./ship-motion-scenarios";

/**
 * NAV-01 fleet grid: the TRADE-01 phase 5 home island sea, a harbour whose berth (113.5, 45.5) lies at the
 * end of a narrow channel, an own ship idle in that channel, a colony ship coming home to the berth after
 * `colonyTimer` seconds and a trade ship sent after `tradeDelay` seconds that enters from the north basin.
 */
interface ChannelFixture { cellsX: number; cellsZ: number; seaVertexRuns: readonly number[] }

/** Seconds a run may take before it counts as a jam. */
export const CHANNEL_JAM_SECONDS = 900;

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/naval-channel-harbour.json"), "utf8")
) as ChannelFixture;

/** Deep-sea vertices decoded from the fixture's alternating land/sea runs. */
const decodeSea = ({ cellsX, cellsZ, seaVertexRuns }: ChannelFixture) => {
  const deep = new Uint8Array((cellsX + 1) * (cellsZ + 1));
  let index = 0, sea = 0;
  for (const run of seaVertexRuns) {
    deep.fill(sea, index, index + run);
    index += run; sea ^= 1;
  }
  return deep;
};
const deepSea = decodeSea(fixture);

const idleChannelShip = (): NavalShip => ({
  cargo: {}, cargoCount: 0, cursor: 0, id: 1, phase: "idle", route: [], speed: 0, timer: 0,
  x: 118.78, y: 0, yaw: 1.0745, z: 27.747
});
const homecomingColonyShip = (harbourUid: number, colonyTimer: number): NavalShip => ({
  cargo: {}, cargoCount: 0, cursor: 0, destinationUid: harbourUid, id: 2, orderId: 2, phase: "away", route: [],
  sourceUid: harbourUid, speed: 0, timer: colonyTimer, x: 121.94, y: 0, yaw: 1.1355, z: 40.557,
  colony: { arrived: true, boxes: 10, exit: { x: 121.5, z: 41.5 }, expeditionId: 1, voyageSeconds: 60 }
});

/** The fleet on the channel harbour with the idle ship and the homecoming colony ship. */
export const createChannelHarbour = (colonyTimer: number) => {
  const sea = createShipSeaWorld(fixture.cellsX, fixture.cellsZ, (x, z) =>
    !deepSea[Math.floor(z) * (fixture.cellsX + 1) + Math.floor(x)]);
  const harbour = sea.harbour(52, 100, 1);
  const events: string[] = [];
  const hooks: NavalPassengerHooks = {
    embark: () => {}, ready: () => true, release: () => {}, colonyVoyage: () => {},
    tradeLoaded: delivery => { events.push(`loaded ${delivery}`); },
    tradeShipGone: delivery => { events.push(`gone ${delivery}`); },
    tradeUnloaded: delivery => { events.push(`unloaded ${delivery}`); return { fish: 2 }; }
  };
  const fleet = createNavalFleet(sea.context, sea.sea, hooks);
  fleet.restore({ nextOrder: 3, nextShip: 3, orders: [],
    ships: [idleChannelShip(), homecomingColonyShip(harbour.uid, colonyTimer)] });
  return { events, fleet, harbour, port: createTradeShipPort(fleet) };
};

/** Seconds until the trade ship has loaded its pickup (CHANNEL_JAM_SECONDS when it never does). */
export const channelTradeSeconds = (colonyTimer: number, tradeDelay: number) => {
  const { events, fleet, harbour, port } = createChannelHarbour(colonyTimer);
  let sent = false, seconds = 0;
  for (; seconds < CHANNEL_JAM_SECONDS && !events.includes("loaded d1"); seconds += SHIP_TICK) {
    if (!sent && seconds >= tradeDelay) sent = port.send(harbour.uid, { stone: 20 }, "d1", 1) !== null;
    fleet.update(SHIP_TICK);
  }
  return Math.round(seconds);
};
