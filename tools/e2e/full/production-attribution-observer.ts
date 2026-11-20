import type { SettlementActor, SettlementBuilding } from "../../../src/shared/settlement/settlement-types";

interface Simulation {
  buildings: () => readonly SettlementBuilding[];
  frames: () => readonly SettlementActor[];
}
interface ActorSample {
  actor: SettlementActor;
  destination?: number;
  phase: string;
  source?: number;
  ware: string | null;
}
interface Pickup {
  actor: number;
  destination: number;
  pickupAt: number;
  pickupPhase: string;
  source: number;
  ware: string;
}
interface Receipt extends Pickup {
  completionPhase: string;
  deliveredAt: number;
  destinationStockAtCompletion: number;
  lastPhase: string;
  removedFromSimulation: boolean;
}

/** Read-only evidence; global stock changes alone never credit this producer. */
export const createProductionAttributionObserver = (
  sim: Simulation, uid: number, outputs: readonly string[], typeId: number
) => {
  const previous = new Map<number, ActorSample>(), picked = new Map<number, Pickup>();
  const evidence: Receipt[] = [], phases = new Set<string>();
  const feed = { grain: 0, water: 0 };
  let previousFeeding: { phase: string; ware: string | null } | undefined;
  let stopped = false, raf = 0, cycles = 0, delivered = 0, maximumGapMs = 0;
  let lastTime = performance.now();
  let cycle = sim.buildings().find(entry => entry.uid === uid)?.cycle ?? 0;

  const sample = () => {
    if (stopped) return;
    const now = performance.now();
    maximumGapMs = Math.max(maximumGapMs, now - lastTime);
    lastTime = now;
    const buildings = sim.buildings(), actors = sim.frames();
    const building = buildings.find(entry => entry.uid === uid);
    if (building && building.cycle !== cycle) {
      const delta = building.cycle - cycle;
      if (delta >= 0) cycles += delta;
      else if (typeId === 24) cycles += (delta + 5) % 5;
      cycle = building.cycle;
    }
    const worker = actors.find(actor => actor.uid === building?.worker);
    if (typeId === 28) {
      if (worker && previousFeeding?.phase === "pigFeedPutdown" && !worker.ware &&
        (previousFeeding.ware === "grain" || previousFeeding.ware === "water"))
        feed[previousFeeding.ware]++;
      previousFeeding = worker ? { phase: worker.phase, ware: worker.ware } : undefined;
    }
    const seen = new Set<number>(), liveIds = new Set(actors.map(actor => actor.uid));
    const sampledActors = [...actors];
    // A delivered carrier retires and is compacted in the same tick. Its previously observed object
    // retains the terminal state; disappearance alone is never proof that its cargo reached storage.
    for (const [id, old] of previous)
      if (picked.has(id) && !liveIds.has(id)) sampledActors.push(old.actor);
    for (const actor of sampledActors) {
      if ((actor.building === uid || actor.delivery?.source === uid || picked.has(actor.uid)) && phases.size < 128)
        phases.add(`${actor.job}:${actor.phase}:${actor.ware ?? "empty"}`);
      const old = previous.get(actor.uid), delivery = actor.delivery;
      let load = picked.get(actor.uid);
      // Cart batches have separate lifecycle/conservation obligations; one actor ware is not a batch receipt.
      if (actor.handcart?.trip) {
        previous.delete(actor.uid);
        picked.delete(actor.uid);
        continue;
      }
      if (load && delivery && (delivery.source !== uid || delivery.ware !== load.ware ||
        delivery.destination !== load.destination)) {
        picked.delete(actor.uid);
        load = undefined;
      }
      if (old && !old.ware && actor.ware && outputs.includes(actor.ware) && delivery?.source === uid &&
        ["pickupTransfer", "exitLoaded"].includes(actor.phase))
        picked.set(actor.uid, { actor: actor.uid, source: uid, destination: delivery.destination,
          ware: actor.ware, pickupAt: now, pickupPhase: actor.phase });
      if (load && old?.ware === load.ware && !actor.ware) {
        const destination = buildings.find(entry => entry.uid === load.destination);
        const handoff = ["enterDelivery", "deliveryTransfer"].includes(old.phase) ||
          (old.phase === "deliver" && destination?.hasDoor === false &&
            Math.hypot(actor.x - destination.access.x, actor.z - destination.access.z) < .5);
        const completedInside = actor.phase === "inside" ||
          (actor.phase === "retired" && actor.job === "Settler" && actor.visible === false);
        if (!delivery && actor.home === load.destination && completedInside &&
          old.source === uid && old.destination === load.destination && handoff &&
          destination?.construction === 1 && [0, 29, 39].includes(destination.typeId)) {
          delivered++;
          if (evidence.length < 64) evidence.push({ ...load, completionPhase: actor.phase,
            deliveredAt: now, lastPhase: old.phase, removedFromSimulation: !liveIds.has(actor.uid),
            destinationStockAtCompletion: destination.inventory[load.ware as keyof typeof destination.inventory] ?? 0 });
        }
        // Dropped/cancelled cargo must never become a later unrelated delivery receipt.
        picked.delete(actor.uid);
      }
      if (liveIds.has(actor.uid) && (delivery?.source === uid || picked.has(actor.uid))) {
        seen.add(actor.uid);
        previous.set(actor.uid, { actor, ware: actor.ware, phase: actor.phase,
          source: delivery?.source, destination: delivery?.destination });
      }
    }
    for (const id of previous.keys()) if (!seen.has(id)) {
      previous.delete(id);
      picked.delete(id);
    }
    raf = requestAnimationFrame(sample);
  };
  sample();
  return {
    read: () => ({ cycles, delivered, evidence: evidence.map(receipt => ({ ...receipt })),
      feed: { ...feed }, maximumGapMs, observedPhases: [...phases], pendingPickups: picked.size }),
    stop: () => { stopped = true; cancelAnimationFrame(raf); }
  };
};
