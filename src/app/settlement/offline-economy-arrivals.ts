import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { HARBOUR_PIER_MAX_LENGTH, HARBOUR_SHORE_ACCESS_MAX_DISTANCE } from "../../shared/settlement/settlement-harbour-docks";
import type { NavalShip } from "../../shared/settlement/settlement-naval-fleet";
import { shipBoxes } from "../../shared/settlement/settlement-naval-ship-handling";
import { OAR_TURN_RATE, SHIP_MANOEUVRE_SPEED } from "../../shared/settlement/settlement-ship-kinematics";
import type { Goods, SettlementPoint } from "../../shared/settlement/settlement-types";
import { shipArrivalEstimate } from "../../shared/settlement/ship-arrival-estimate";
import { dockPorterSpeedFactor, planCargoHandling } from "../../shared/settlement/ship-cargo-handling";
import { tradeShipBoxUnloaded, tradeShipGone } from "../../shared/trade/trade-shipping";
import type { TradeEscrow, TradeIslandPort } from "../../shared/trade/trade-types";
import type { OfflineEconomyEventsResult, OfflineEconomyIsland, OfflineEconomyJob } from "./offline-economy-events";
import { OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS } from "./offline-economy-rates";
import { DMath } from "../../shared/math/deterministic-math";

interface Arrival { ship: NavalShip; cargo: Goods; uid: string; harbour: number }
type Ledger = OfflineEconomyEventsResult["islands"][number];
const positive = (goods: Readonly<Goods>) => Object.fromEntries(Object.entries(goods).filter(([, count]) => count > 0));
const matches = (left: Readonly<Goods>, right: Readonly<Goods>) =>
  [...new Set([...Object.keys(left), ...Object.keys(right)])].every(ware => (left[ware] ?? 0) === (right[ware] ?? 0));
const distance = (a: SettlementPoint, b: SettlementPoint) => DMath.hypot(a.x - b.x, a.z - b.z);
const heldCount = (escrow: TradeEscrow, ware: string) =>
  escrow.held.reduce((sum, held) => sum + (held.goods[ware] ?? 0), escrow.staged[ware] ?? 0);
/** The escrow of a trade delivery is fully reserved (staged, or held in its pool): nothing is spent twice. */
const tradePaymentOwned = (state: GameSaveV1["settlement"], deliveryId: string) => {
  const delivery = state.trade!.deliveries.find(entry => entry.id === deliveryId)!;
  const escrow = state.trade!.escrow.find(entry => entry.id === delivery.escrowId);
  return !escrow || Object.entries(escrow.goods).every(([ware, count]) => heldCount(escrow, ware) >= count);
};

/**
 * Already-owned inbound cargo gets one causal transfer from a virtual ship account. No merchant
 * purchase, reward or production is invented. Original cargo stays unchanged unless that transfer
 * completes; completed visitors retire and real trade callbacks prevent delivery a second time.
 */
export const prepareOfflineEconomyArrivals = (
  save: GameSaveV1, islandId: string, seconds: number
): { islands: OfflineEconomyIsland[]; jobs: OfflineEconomyJob[];
  apply: (completedCycles: Record<string, number>, ledger: Ledger) => void; notes: string[] } => {
  const islands: OfflineEconomyIsland[] = [], jobs: OfflineEconomyJob[] = [], notes: string[] = [];
  const arrivals: Arrival[] = [], state = save.settlement, talents = talentModifiers(save.player?.talents);
  const horizon = Math.max(0, Math.floor(seconds * TPS));
  const tradeMatches = (arrival: Arrival) => {
    const delivery = state.trade?.deliveries.find(delivery => delivery.id === arrival.ship.visitor?.trade?.delivery &&
      delivery.shipId === arrival.ship.id);
    return !!delivery && delivery.outbound === undefined && matches(positive(delivery.aboard ?? {}), arrival.cargo) &&
      Object.entries(arrival.cargo).every(([ware, count]) => (delivery.goods[ware] ?? 0) >= count);
  };
  for (const ship of state.naval.fleet.ships) {
    const visitor = ship.visitor, role = visitor?.role ?? "supply";
    if (!visitor || visitor.leaving || !["trade", "supply", "reward"].includes(role) ||
      ship.phase === "loading" || ship.orderId !== undefined || ship.lighters || ship.terrainBlocked ||
      ship.colony || ship.expedition || ship.exploration || visitor.pickup.length ||
      visitor.pickupTroops?.length || ship.passengers?.length || ship.troops?.length) continue;
    const cargo = positive(ship.cargo);
    if (!Object.keys(cargo).length) continue;
    const harbour = state.buildings.find(building => building.uid === ship.destinationUid &&
      building.construction === 1 && !building.militaryFaction && STORAGE_IDS.has(building.typeId));
    if (!harbour) { notes.push(`Ship ${ship.id}: inbound destination unavailable; cargo retained.`); continue; }
    const uid = `arrival:${islandId}:${ship.id}`, arrival = { ship, cargo, uid, harbour: harbour.uid };
    if (role === "trade" && (!visitor.trade || !tradeMatches(arrival))) {
      notes.push(`Ship ${ship.id}: trade receipt does not match held cargo; arrival deferred.`); continue;
    }
    if (visitor.trade && !tradePaymentOwned(state, visitor.trade.delivery)) {
      notes.push(`Ship ${ship.id}: payment ownership unresolved; arrival deferred.`); continue;
    }
    const porters = dockPorterSpeedFactor(harbour.workshopUpgrade?.level ?? 0, talents.dockPorterSpeed);
    const handling = ship.phase === "unloading" ? Math.max(0, ship.timer) :
      planCargoHandling(shipBoxes(ship), HARBOUR_PIER_MAX_LENGTH + HARBOUR_SHORE_ACCESS_MAX_DISTANCE +
        distance(harbour.doorThreshold, harbour.access), 10, porters).seconds;
    const queued = state.naval.fleet.ships.filter(other => other.id !== ship.id && other.destinationUid === harbour.uid &&
      other.visitor && !other.visitor.leaving && (other.visitor.trade?.queue ?? -1) < (visitor.trade?.queue ?? Infinity))
      .reduce((sum, other) => sum + (other.handling?.seconds ?? handling), 0);
    // Stranded/queued saves have no live arrival estimate. A return across the harbour approach,
    // one complete manoeuvre and actual porter work provide a bounded geometric approximation.
    const course = shipArrivalEstimate(ship) ??
      2 * distance(ship, harbour.access) / SHIP_MANOEUVRE_SPEED + 2 * Math.PI / OAR_TURN_RATE;
    const delay = Math.max(.001, course + handling + queued);
    const escrowId = `~arrival:${islandId}:${ship.id}`;
    islands.push({ islandId: escrowId, stock: { ...cargo } });
    jobs.push({ uid, islandId: escrowId, destinationIslandId: islandId, kind: "transfer",
      cycleTicks: Math.ceil(delay * TPS), endTick: horizon, inputs: { ...cargo }, outputs: { ...cargo } });
    arrivals.push(arrival);
    notes.push(`Ship ${ship.id}: already-owned ${role} cargo arrives after ${Math.ceil(delay)}s; ` +
      "sailing and pier queues are approximated without spending escrow twice.");
  }
  let applied = false;
  return { islands, jobs, notes, apply: (completedCycles, ledger) => {
    if (applied) throw new Error("Offline arrivals already applied");
    const completed = arrivals.filter(arrival => {
      const cycles = completedCycles[arrival.uid] ?? 0;
      if (cycles !== 0 && cycles !== 1) throw new Error("Offline inbound cargo arrived more than once");
      return cycles === 1;
    });
    const credited: Goods = {};
    for (const arrival of completed) {
      if (!state.naval.fleet.ships.includes(arrival.ship) || !matches(positive(arrival.ship.cargo), arrival.cargo) ||
        (arrival.ship.visitor?.trade && !tradeMatches(arrival))) throw new Error("Offline inbound cargo changed before commit");
      for (const [ware, count] of Object.entries(arrival.cargo)) credited[ware] = (credited[ware] ?? 0) + count;
    }
    for (const [ware, count] of Object.entries(credited))
      if ((ledger.received[ware] ?? 0) < count) throw new Error("Offline inbound cargo missing destination credit");
    applied = true;
    // Transfer bookkeeping already credited storage. Only that callback's receipt mutation is needed.
    const noStorePort = { store: () => {} } as unknown as TradeIslandPort;
    for (const arrival of completed) {
      const trade = arrival.ship.visitor?.trade;
      if (trade) {
        tradeShipBoxUnloaded(state.trade!, noStorePort, trade.delivery, arrival.ship.id, arrival.harbour, arrival.cargo);
        tradeShipGone(state.trade!, trade.delivery, arrival.ship.id);
      }
      arrival.ship.cargo = {}; arrival.ship.cargoCount = 0;
      state.naval.fleet.ships.splice(state.naval.fleet.ships.indexOf(arrival.ship), 1);
    }
    // These goods were already counted in this island's physical ship holdings, so this is an
    // internal move, not an economic cross-island receipt in the conservation report.
    for (const [ware, count] of Object.entries(credited)) ledger.received[ware] = (ledger.received[ware] ?? 0) - count;
  } };
};
