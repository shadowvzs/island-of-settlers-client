import type { ShuttleJob, ShuttleState } from "./harbour-shuttle-plan";
import { addGood } from "./production-rules";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementBuilding } from "./settlement-types";
import type { StoragePoolState } from "./shared-storage";
import { storageContribution } from "./storage-capacity";

export interface OfflineShuttleSettlement {
  buildings: SettlementBuilding[];
  storagePools?: StoragePoolState;
  settlers: number;
  transfers: Array<{ count: number; destination: number; source: number; ware: string }>;
}
const harbor = (settlement: OfflineShuttleSettlement, uid: number) =>
  settlement.buildings.find(building => building.uid === uid && building.typeId === 39 && building.construction === 1);
const addLoad = (goods: Record<string, number>, load: Readonly<Record<string, number>>) => {
  for (const [ware, count] of Object.entries(load)) addGood(goods, ware, count);
};
const empty = (goods: Readonly<Record<string, number>>) => Object.values(goods).every(count => count <= 0);
const accepted = (building: SettlementBuilding, cargo: Readonly<Record<string, number>>) =>
  Object.keys(cargo).every(ware => building.accepts[ware] !== false);
const stockAt = (settlement: OfflineShuttleSettlement, building: SettlementBuilding) =>
  building.storagePoolId === undefined ? building.inventory :
    settlement.storagePools?.pools.find(pool => pool.id === building.storagePoolId && pool.owner === 0)?.available;
const room = (settlement: OfflineShuttleSettlement, building: SettlementBuilding,
  cargo: Readonly<Record<string, number>>, reserved = false) => {
  const stock = stockAt(settlement, building);
  if (!stock) return false;
  const members = building.storagePoolId === undefined ? [building] : settlement.buildings.filter(member =>
    member.storagePoolId === building.storagePoolId && member.construction === 1 && isOwnBuilding(member));
  const capacity = members.reduce((sum, member) => sum + storageContribution(member), 0);
  return capacity > 0 && Object.entries(cargo).every(([ware, count]) => {
    const incoming = members.reduce((sum, member) => sum + (member.incoming[ware] ?? 0), 0);
    const held = members.reduce((sum, member) => sum + (member.shipReserve?.[ware] ?? 0), 0);
    return (stock[ware] ?? 0) + held + incoming + (reserved ? 0 : count) <= capacity;
  });
};
/** Offline may release only at the original home; orphan recovery needs an actual native water route. */
const release = (settlement: OfflineShuttleSettlement, job: ShuttleJob) => {
  const home = harbor(settlement, job.homeUid ?? job.sourceUid);
  if (!home) return false;
  home.idleSettlers = (home.idleSettlers ?? 0) + job.crew;
  settlement.settlers += job.crew;
  return true;
};
const handoff = (job: ShuttleJob, point: { x: number; z: number }) => {
  job.phase = "blocked"; job.timer = 1; job.interrupted = "source-lost";
  job.hold = { ...point };
  job.returningHome = empty(job.cargo) || undefined;
  return false;
};
/** A returned explicit transfer reopens its one shared fulfillment claim exactly once. */
const restoreDemand = (settlement: OfflineShuttleSettlement, job: ShuttleJob, count: number) => {
  const demand = job.demand;
  if (!demand || demand.automatic || demand.restored || count < 1 ||
    !settlement.buildings.some(building => building.uid === demand.destination)) return;
  const existing = settlement.transfers.find(order => order.source === job.sourceUid &&
    order.destination === demand.destination && order.ware === demand.ware);
  if (existing) existing.count += count;
  else settlement.transfers.push({ count, destination: demand.destination, source: job.sourceUid, ware: demand.ware });
  demand.restored = true;
};
/** The destination reservation is released when the cargo is unloaded or comes back. */
const releaseIncoming = (settlement: OfflineShuttleSettlement, job: ShuttleJob) => {
  const destination = harbor(settlement, job.destinationUid);
  if (!destination) return;
  for (const [ware, count] of Object.entries(job.cargo)) addGood(destination.incoming, ware, -count);
};
const refund = (settlement: OfflineShuttleSettlement, job: ShuttleJob) => {
  if (empty(job.cargo)) return true;
  const source = harbor(settlement, job.sourceUid);
  if (!source || !accepted(source, job.cargo) || !room(settlement, source, job.cargo)) return false;
  const count = Object.values(job.cargo).reduce((sum, units) => sum + units, 0);
  releaseIncoming(settlement, job);
  addLoad(stockAt(settlement, source)!, job.cargo); job.cargo = {};
  restoreDemand(settlement, job, count);
  return true;
};
const finishReturn = (settlement: OfflineShuttleSettlement, job: ShuttleJob) => {
  if (!refund(settlement, job)) return handoff(job, job.sourceLanding);
  if ((job.homeUid ?? job.sourceUid) !== job.sourceUid || !release(settlement, job))
    return handoff(job, job.sourceLanding);
  job.done = true; return true;
};
const unload = (settlement: OfflineShuttleSettlement, job: ShuttleJob) => {
  const destination = harbor(settlement, job.destinationUid);
  if (!destination || !accepted(destination, job.cargo) || !room(settlement, destination, job.cargo, true)) {
    job.phase = "blocked"; job.timer = 1; job.interrupted = destination ? "destination-full" : "destination-lost";
    return false;
  }
  releaseIncoming(settlement, job);
  addLoad(stockAt(settlement, destination)!, job.cargo); job.cargo = {};
  if (!harbor(settlement, job.homeUid ?? job.sourceUid)) return handoff(job, job.destinationLanding);
  job.phase = "returning"; job.timer = job.plan.returning; job.interrupted = undefined; return true;
};
/**
 * Offline fast lane (BOAT-P04): existing saved boat jobs advance by their saved finite timetable at
 * most once. No new job is created and no route is replanned, so a long absence cannot generate
 * unlimited transfers. A full/lost destination leaves the cargo aboard and blocked for exact native
 * recovery; source goods were already reserved by the job, so no native-prefix stock is duplicated.
 */
export const advanceOfflineHarbourShuttles = (state: ShuttleState | undefined,
  settlement: OfflineShuttleSettlement, seconds: number) => {
  if (!state || !Number.isFinite(seconds) || seconds <= 0) return { completed: 0, remaining: 0 };
  let completed = 0, remaining = 0;
  for (const job of state.jobs) {
    let left = seconds;
    while (left > 0 && !job.done) {
      if (job.phase === "blocked") { remaining++; break; }
      if (left < job.timer) { job.timer -= left; left = 0; break; }
      left -= job.timer;
      if (job.phase === "loading") { job.phase = "outbound"; job.timer = job.plan.outbound; continue; }
      if (job.phase === "outbound") { job.phase = "unloading"; job.timer = job.plan.unloading; continue; }
      if (job.phase === "unloading") {
        if (!unload(settlement, job)) { remaining++; break; }
        continue;
      }
      if (job.phase === "returning") {
        if (finishReturn(settlement, job)) completed++;
        else remaining++;
        break;
      }
    }
    if (!job.done && left <= 0) remaining++;
  }
  state.jobs.splice(0, state.jobs.length, ...state.jobs.filter(job => !job.done));
  return { completed, remaining };
};
