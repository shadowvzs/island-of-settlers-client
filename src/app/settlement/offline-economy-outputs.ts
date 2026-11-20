import { getBuildingStockContact } from "../../render-common/buildings/building-stock-anchors";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { CARRIER_WALK_SPEED, PRODUCTION_OUTPUT_CAPACITY } from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import type { SettlementBuilding, SettlementPoint } from "../../shared/settlement/settlement-types";
import type { WorldData } from "../../shared/world/world-data";
import type { OfflineEconomyEventsResult, OfflineEconomyIsland, OfflineEconomyJob } from "./offline-economy-events";
import { OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS } from "./offline-economy-rates";

type Ledger = OfflineEconomyEventsResult["islands"][number];
interface OutputClaim { building: SettlementBuilding; ware: string; units: number; original: number; ownership: string; uid: string }
const own = (record: Record<string, number>, key: string) => Object.hasOwn(record, key) ? record[key]! : 0;
const distance = (from: SettlementPoint, to: SettlementPoint) => DMath.hypot(to.x - from.x, to.z - from.z);

/** Already-completed, unclaimed output moves once; saved carrier/worker receipts retain their goods. */
export const prepareOfflineEconomyOutputs = (
  save: GameSaveV1, islandId: string, seconds: number, world: WorldData, storageUids: readonly number[],
  excludedOutputUids: readonly number[] = []
): { islands: OfflineEconomyIsland[]; jobs: OfflineEconomyJob[];
  apply: (completedCycles: Record<string, number>, ledger: Ledger) => void; notes: string[] } => {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.floor(seconds * TPS)))
    throw new Error("Invalid offline output horizon");
  const islands: OfflineEconomyIsland[] = [], jobs: OfflineEconomyJob[] = [], notes: string[] = [];
  const claims: OutputClaim[] = [], state = save.settlement, allowed = new Set(storageUids);
  const roads = createRoadNetwork(world);
  if (!roads.replaceSegments(state.roads)) throw new Error("Invalid offline output roads");
  const storages = state.buildings.filter(building => allowed.has(building.uid) && building.construction === 1 &&
    !building.militaryFaction && STORAGE_IDS.has(building.typeId));
  const availableCarriers = state.actors.some(actor => actor.job === "Carrier") || state.settlers > 0;
  const speed = CARRIER_WALK_SPEED * (1 + talentModifiers(save.player?.talents).carrierSpeed);
  const ownership = (building: SettlementBuilding, ware: string) => {
    let held = 0, valid = true;
    const owners: unknown[] = [];
    for (const actor of state.actors) {
      const delivery = actor.delivery;
      if (delivery?.source === building.uid && delivery.ware === ware && delivery.reserved && !delivery.sourceInput) {
        held++;
        owners.push(["delivery", actor.uid]);
      }
      const trip = actor.handcart?.trip;
      if (trip?.source === building.uid && trip.ware === ware) {
        const amount = trip.planned - trip.loaded - trip.prepaid;
        if (![trip.planned, trip.loaded, trip.prepaid, amount].every(value => Number.isSafeInteger(value) && value >= 0)) valid = false;
        held += amount;
        owners.push(["cart", actor.uid, trip.planned, trip.loaded, trip.prepaid]);
      }
    }
    return { held, valid, snapshot: JSON.stringify(owners) };
  };
  for (const building of state.buildings) {
    if (building.construction !== 1 || building.militaryFaction || STORAGE_IDS.has(building.typeId) ||
      excludedOutputUids.includes(building.uid)) continue;
    if (!availableCarriers) continue;
    for (const [ware, original] of Object.entries(building.output)) {
      if (jobs.length >= 250) { notes.push("Completed output dispatch capped at250 source/ware accounts."); break; }
      const held = ownership(building, ware), units = original - held.held;
      if (!Number.isSafeInteger(original) || original < 0 || !held.valid || units < 0) {
        notes.push(`Building ${building.uid} ${ware}: ambiguous output ownership; retained.`); continue;
      }
      if (!units) continue;
      const candidates = storages.filter(storage => storage.accepts[ware] !== false).flatMap(storage => {
        const route = roads.routeMetrics(building.access, storage.access).route;
        return route ? [{ storage, route }] : [];
      }).sort((left, right) => left.route.cost - right.route.cost || left.storage.uid - right.storage.uid);
      const chosen = candidates[0];
      if (!chosen) { notes.push(`Building ${building.uid} ${ware}: no accepting connected warehouse; retained.`); continue; }
      // Courier starts at the receiver, collects the real output, then returns through its door.
      let sourceLeg = 0;
      for (let slot = 0; slot < Math.min(original, PRODUCTION_OUTPUT_CAPACITY); slot++) {
        const contact = getBuildingStockContact(building.typeId, "output", ware, slot, building.x, building.z,
          building.rotation, building.y, building.output, building.input, stockStyleFor(state.playerNation, building));
        sourceLeg = Math.max(sourceLeg, contact ? distance(building.access,
          { x: contact.approach[0], z: contact.approach[2] }) : 0);
      }
      const storageLeg = distance(chosen.storage.access, chosen.storage.workerApproach) +
        distance(chosen.storage.workerApproach, chosen.storage.doorThreshold);
      const cycleTicks = Math.max(1, Math.ceil(units * (2 * (chosen.route.cost + sourceLeg + storageLeg) / speed + 2) * TPS));
      if (!Number.isSafeInteger(cycleTicks)) { notes.push(`Building ${building.uid} ${ware}: output trip exceeds safe timing; retained.`); continue; }
      const uid = `output:${JSON.stringify([islandId, building.uid, ware])}`;
      const escrowId = `~${uid}`;
      const cargo = Object.fromEntries([[ware, units]]);
      islands.push({ islandId: escrowId, stock: cargo });
      jobs.push({ uid, islandId: escrowId, destinationIslandId: islandId, kind: "transfer", cycleTicks,
        endTick: Math.floor(seconds * TPS), inputs: cargo, outputs: cargo });
      claims.push({ building, ware, units, original, ownership: held.snapshot, uid });
    }
  }
  if (jobs.length) notes.push("Unreserved completed output uses finite courier escrow; whole round trips and authored stock/door legs are serialized per ware. Additional pickup work does not share the production carrier work budget.");
  let applied = false;
  return { islands, jobs, notes, apply: (completedCycles, ledger) => {
    if (applied) throw new Error("Offline outputs already applied");
    if (ledger.islandId !== islandId) throw new Error("Offline output destination ledger mismatch");
    const completed = claims.filter(claim => {
      const cycles = own(completedCycles, claim.uid);
      if (cycles !== 0 && cycles !== 1) throw new Error("Offline output collected more than once");
      return cycles === 1;
    });
    const credited: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const claim of completed) {
      const held = ownership(claim.building, claim.ware);
      if (!state.buildings.includes(claim.building) || own(claim.building.output, claim.ware) !== claim.original ||
        !held.valid || held.snapshot !== claim.ownership || claim.original - held.held !== claim.units)
        throw new Error("Offline output ownership changed before commit");
      credited[claim.ware] = own(credited, claim.ware) + claim.units;
    }
    for (const [ware, units] of Object.entries(credited))
      if (own(ledger.received, ware) < units) throw new Error("Offline output missing destination credit");
    applied = true;
    for (const claim of completed) claim.building.output[claim.ware] = claim.original - claim.units;
    for (const [ware, units] of Object.entries(credited)) ledger.received[ware] = own(ledger.received, ware) - units;
  } };
};
