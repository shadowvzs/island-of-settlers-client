import { createOfflineInputBufferScheduler, type DirectInputTrip } from "./offline-economy-input-buffers";
import { add, createOfflineEconomyEventState, integer, own, record, total } from "./offline-economy-state";
import { previewOfflineTransport, reserveOfflineTransport } from "./offline-economy-work";

/** Integer economic events. This kernel owns goods only; it does not estimate cycle durations. */
export type EconomyGoods = Record<string, number>;
export interface OfflineEconomyIsland {
  islandId: string;
  /** Internal producer accounts retain physical ownership on their real island. */
  ownerIslandId?: string;
  /** A workshop yard shares its slots across every output ware. */
  totalCapacity?: number;
  /** Physical shelf limit after already-owned saved cargo has been collected. */
  maxCapacity?: number;
  stock: EconomyGoods;
  capacities?: EconomyGoods;
  /** Shared transport work earned per elapsed tick (normally the number of available carriers). */
  workCapacity?: number;
  /** Optional bounded staffing for the new flax/cloth/ship chain; no future births are borrowed. */
  recruitableWorkers?: number;
}
export interface OfflineEconomyJob {
  uid: string;
  islandId: string;
  /** Transfers preserve their exact cargo and use the destination's reserved storage. */
  kind?: "production" | "transfer";
  destinationIslandId?: string;
  /** Saved local deliveries may retain their already-reserved workshop destination. */
  destinationBufferUid?: string;
  /** Physical production waits in this producer's yard; synthetic source tokens stay local. */
  outputAccountId?: string;
  /** Transfers may use their owner's shared fleet rather than an internal account's capacity. */
  workOwnerIslandId?: string;
  /** Transfer-only: unit cargo expands to the available amount at departure. */
  maxTransferUnits?: number;
  /** Dynamic transfer minimum cargo; smaller available batches wait. Defaults to one. */
  minTransferUnits?: number;
  /** Transfer departure spacing, measured from the last departure. Defaults to cycleTicks. */
  startIntervalTicks?: number;
  sourceReserves?: EconomyGoods;
  destinationTargets?: EconomyGoods;
  /** Transfers of any listed ware share one destination target, including in-flight cargo. */
  destinationTargetGroup?: { wares: string[]; units: number };
  cycleTicks: number;
  /** Transport work charged once per cycle, independent of the worker's production duration. */
  workTicks?: number;
  /** A measured full cycle already includes transport waits; charge capacity without adding them twice. */
  workOverlapsCycle?: boolean;
  /** Bounded yard exports release their shelf at pickup, before the warehouse arrival. */
  sourceReleaseTicks?: number;
  /** Saved private receipts drop off before their full return; the complete trip must fit the horizon. */
  destinationArrivalTicks?: number;
  /** Completing an original receipt releases its retained producer shelf slots once. */
  capacityReleases?: { islandId: string; units: number; at?: "pickup" | "completion" }[];
  firstTick?: number;
  /** Inclusive completion deadline; later work never pays inputs. */
  endTick?: number;
  inputs: EconomyGoods;
  outputs: EconomyGoods;
  /** Production-only finite outputs, selected by completed cycle index. */
  outputSequence?: EconomyGoods[];
  /** An original paid worker cycle completes once before the planned output sequence. */
  paidOutput?: { ware: string; ticks: number };
  /** Production-only warehouse-backed buffers; retained goods keep their warehouse slots reserved. */
  inputTargets?: EconomyGoods;
  /** Shared input priority; 1 is neutral. Lower values yield scarce grain/water to staples first. */
  priority?: number;
  /** Unreserved goods already inside this workshop; they never become free warehouse stock. */
  initialInputs?: EconomyGoods;
  /** Physical input lead times. Reserved goods cannot fund production until their delivery arrives. */
  inputDeliveryTicks?: EconomyGoods;
  inputSuppliers?: Record<string, { accountId: string; routeCost: number; deliveryTicks: number; workTicks: number }[]>;
  /** Pick one available finite source identity while paying the shared source pool once. */
  sourceChoices?: { input: string; choices: {
    token: string; priority: number; outputs?: EconomyGoods; cycleTicks?: number
  }[] };
  /** Choose one available food in this order in addition to the fixed inputs. */
  alternativeFoods?: string[];
  foodUnits?: number;
  /** On a horizon refund, returned physical inputs belong to this building's private buffer. */
  privateRefundBuilding?: number;
}
export interface OfflineEconomyEventsOptions {
  horizonTicks: number;
  /** Deterministic work limit; exceeding it throws without returning a partial result. */
  maxEvents?: number;
  islands: OfflineEconomyIsland[];
  jobs: OfflineEconomyJob[];
  onCompleted?: (job: Readonly<OfflineEconomyJob>, tick: number, inputs: Readonly<EconomyGoods>,
    outputs: Readonly<EconomyGoods>, startTick: number) => void;
}
export interface OfflineEconomyPaidWork {
  uid: string;
  islandId: string;
  kind?: "transfer";
  destinationIslandId?: string;
  startTick: number;
  finishTick: number;
  inputs: EconomyGoods;
  outputs: EconomyGoods;
}
export interface OfflineEconomyEventsResult {
  /** sent counts departures; received counts arrivals. In-flight cargo is in inProgress. */
  islands: { islandId: string; stock: EconomyGoods; produced: EconomyGoods; consumed: EconomyGoods;
    sent: EconomyGoods; received: EconomyGoods; totalCapacity?: number; recruitedWorkers?: number }[];
  buffers: { uid: string; islandId: string; stock: EconomyGoods; deliveredStock?: EconomyGoods;
    directStock?: EconomyGoods; ownedStock?: EconomyGoods }[];
  inProgress: OfflineEconomyPaidWork[];
  completedCycles: Record<string, number>;
  events: number;
}

export interface OfflineEconomyEvent {
  tick: number; finish: boolean; job: number; island: number; sequence: number;
  arrival?: boolean;
  sourceRelease?: boolean;
  delivery?: { ware: string; units: number; direct?: number };
}
type Event = OfflineEconomyEvent;
const before = (a: Event, b: Event) => a.tick - b.tick || Number(b.finish) - Number(a.finish) ||
  Number(!!b.delivery) - Number(!!a.delivery) ||
  a.island - b.island || a.job - b.job || a.sequence - b.sequence;
class EventQueue {
  private heap: Event[] = [];
  push(event: Event) {
    const heap = this.heap;
    let index = heap.length;
    heap.push(event);
    while (index) {
      const parent = (index - 1) >>> 1;
      if (before(heap[parent]!, event) <= 0) break;
      heap[index] = heap[parent]!; index = parent;
    }
    heap[index] = event;
  }
  pop(): Event | undefined {
    const heap = this.heap, first = heap[0], last = heap.pop();
    if (!heap.length || !last) return first;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!) < 0) child++;
      if (before(last, heap[child]!) <= 0) break;
      heap[index] = heap[child]!; index = child;
    }
    heap[index] = last;
    return first;
  }
}
const groupRoom = (group: OfflineEconomyJob["destinationTargetGroup"], stock: EconomyGoods, reserved: EconomyGoods) => {
  if (!group) return Infinity;
  let left = group.units;
  for (const ware of group.wares) {
    left -= Math.min(left, own(stock, ware));
    left -= Math.min(left, own(reserved, ware));
  }
  return left;
};

type EventState = ReturnType<typeof createOfflineEconomyEventState>;

const creditJobOutput = (prepared: EventState, index: number) => {
  const { jobs, states } = prepared, job = jobs[index]!, state = states[job.island]!;
  const transfer = job.definition.kind === "transfer";
  const bufferTarget = job.bufferDestination === undefined ? undefined : jobs[job.bufferDestination]!;
  const credited = new Map<number, string[]>();
  for (const [ware, amount] of Object.entries(job.paid!.outputs)) {
    const at = job.definition.outputAccountId && ware.startsWith("~") ? job.island : job.destination;
    const target = states[at]!;
    if (bufferTarget) {
      add(bufferTarget.externalIncoming, ware, -amount);
      add(bufferTarget.deliveredStock, ware, amount);
    } else {
      add(target.reserved, ware, -amount); add(target.stock, ware, amount);
      if (!transfer && at !== job.island) add(target.received, ware, amount);
      const keys = credited.get(at) ?? [];
      keys.push(ware); credited.set(at, keys);
    }
    add(transfer ? target.received : state.produced, ware, amount);
  }
  return credited;
};

const spendJobInputs = (prepared: EventState, index: number, inputs: EconomyGoods) => {
  const job = prepared.jobs[index]!, state = prepared.states[job.island]!;
  const transfer = job.definition.kind === "transfer";
  for (const [ware, amount] of Object.entries(inputs)) {
    const owned = Math.min(amount, own(job.ownedStock, ware));
    if (owned) add(job.ownedStock, ware, -owned);
    const delivered = Math.min(amount - owned, own(job.deliveredStock, ware));
    if (delivered) add(job.deliveredStock, ware, -delivered);
    const direct = Math.min(amount - owned - delivered, own(job.directStock, ware));
    if (direct) add(job.directStock, ware, -direct);
    const buffered = Math.min(amount - owned - delivered - direct, own(job.buffer, ware));
    if (buffered) { add(job.buffer, ware, -buffered); add(state.reserved, ware, -buffered); }
    add(state.stock, ware, -(amount - owned - buffered - delivered - direct));
    add(transfer ? state.sent : state.consumed, ware, amount);
    if (transfer && state.totalCapacity !== undefined) add(state.reserved, ware, amount);
  }
};

const finishEconomyEvents = (prepared: EventState, directTrips: DirectInputTrip[],
  completedCycles: EconomyGoods, events: number): OfflineEconomyEventsResult => {
  const { jobs, states } = prepared;
  for (const trip of directTrips) if (!trip.arrived) {
    add(states[trip.source]!.reserved, trip.ware, -trip.units);
    add(states[trip.source]!.stock, trip.ware, trip.units);
    add(states[trip.source]!.sent, trip.ware, -trip.units);
    add(jobs[trip.target]!.directIncoming, trip.ware, -trip.units);
  }
  return { islands: states.map(({ consumed, islandId, produced, received, recruitedWorkers, sent, stock, totalCapacity }) =>
    ({ islandId, stock, produced, consumed, sent, received,
      ...(recruitedWorkers ? { recruitedWorkers } : {}),
      ...(totalCapacity === undefined ? {} : { totalCapacity }) })),
    buffers: jobs.flatMap(job => {
      if (job.definition.inputTargets === undefined) return [];
      const stock = Object.assign(record(), job.buffer);
      for (const [ware, units] of Object.entries(job.pendingInputs)) if (units) add(stock, ware, units);
      return [{ uid: job.definition.uid, islandId: job.definition.islandId, stock,
        ...(Object.values(job.deliveredStock).some(units => units > 0) ? { deliveredStock: job.deliveredStock } : {}),
        ...(job.definition.initialInputs ? { ownedStock: job.ownedStock } : {}),
        ...(Object.values(job.directStock).some(units => units > 0) ? { directStock: job.directStock } : {}) }];
    }),
    inProgress: jobs.flatMap(job => job.paid ? [job.paid] : []), completedCycles, events };
};

/**
 * Fixed inputs (including finite source keys prefixed with `~`) are paid once at start. Output
 * slots are reserved at start, preventing concurrent cycles from overfilling storage. Completions
 * at the horizon count; starts at the horizon do not. Paid work finishing later remains explicit.
 * Blocked jobs retry only when an input or output-capacity dependency changes. Every completion
 * is at least one tick after its start, so goods cannot cross an instantaneous production chain.
 * Transfers move existing cargo without contributing to gross production or consumption. A
 * deterministic event budget throws before processing excess work; caller input is never mutated.
 */
export const runOfflineEconomyEvents = (options: OfflineEconomyEventsOptions): OfflineEconomyEventsResult => {
  integer(options.horizonTicks, "horizon");
  const maxEvents = options.maxEvents ?? 1_000_000;
  integer(maxEvents, "max events", 1);
  const prepared = createOfflineEconomyEventState(options);
  const { inputDependencies, islandIndex, jobs, spaceDependencies, states } = prepared;
  const queue = new EventQueue();
  const outputIsland = (index: number, ware: string) => {
    const job = jobs[index]!;
    return job.definition.outputAccountId && ware.startsWith("~") ? job.island : job.destination;
  };
  const directTrips: DirectInputTrip[] = [];
  let sequence = 0, events = 0;
  const completedCycles = record();
  const schedule = (index: number, tick: number) => {
    const job = jobs[index]!;
    const at = Math.max(tick, job.nextStart);
    if (job.queued || job.paid || job.stopped || at >= options.horizonTicks ||
      at >= (job.definition.endTick ?? Infinity)) return;
    job.queued = true;
    queue.push({ tick: at, finish: false, job: index, island: job.island, sequence: sequence++ });
  };
  const wake = (dependencies: Map<string, Set<number>>[], island: number, keys: string[], tick: number) => {
    for (const key of keys) for (const index of dependencies[island]!.get(key) ?? [])
      if (jobs[index]!.blocked) schedule(index, tick);
  };
  const fillBuffers = createOfflineInputBufferScheduler({ completedCycles, directTrips,
    enqueue: event => queue.push({ ...event, sequence: sequence++ }),
    horizonTicks: options.horizonTicks, prepared });
  states.forEach((_, island) => fillBuffers(island, [...inputDependencies[island]!.keys()], 0));
  jobs.forEach((job, index) => schedule(index, job.definition.firstTick ?? 0));
  let event: Event | undefined;
  while ((event = queue.pop())) {
    if (event.tick > options.horizonTicks) break;
    if (events >= maxEvents) {
      const hot = jobs.slice().sort((a, b) => b.handledEvents - a.handledEvents).slice(0, 6)
        .map(job => `${job.definition.uid}:${job.handledEvents}`).join(", ");
      throw new Error(`Offline economy event budget exceeded (${maxEvents}) at tick ${event.tick}; ${hot}`);
    }
    events++;
    const currentJob = event.job;
    const job = jobs[event.job]!, definition = job.definition, state = states[job.island]!;
    job.handledEvents++;
    const destination = states[job.destination]!, transfer = definition.kind === "transfer";
    if (event.sourceRelease) {
      if (!job.paid || job.sourceReleased) throw new Error("Invalid source pickup continuation");
      if (state.totalCapacity !== undefined)
        for (const [ware, amount] of Object.entries(job.paid.inputs)) add(state.reserved, ware, -amount);
      for (const release of definition.capacityReleases ?? []) {
        if ((release.at ?? "completion") !== "pickup") continue;
        const at = islandIndex.get(release.islandId)!, target = states[at]!;
        const capacity = target.totalCapacity! + release.units;
        if (capacity > target.maxCapacity!) throw new Error("Saved receipt released excess shelf slots");
        target.totalCapacity = capacity;
        wake(spaceDependencies, at, [...spaceDependencies[at]!.keys()], event.tick);
      }
      job.sourceReleased = true;
      wake(spaceDependencies, job.island, Object.keys(job.paid.inputs), event.tick);
      continue;
    }
    if (event.delivery) {
      const { units, ware } = event.delivery;
      if (event.delivery.direct !== undefined) {
        const trip = directTrips[event.delivery.direct]!;
        trip.arrived = true;
        add(states[trip.source]!.reserved, ware, -units);
        add(job.directIncoming, ware, -units);
        add(job.directStock, ware, units);
        wake(spaceDependencies, trip.source, [ware], event.tick);
      } else {
        add(job.pendingInputs, ware, -units);
        add(job.buffer, ware, units);
      }
      schedule(event.job, event.tick);
      continue;
    }
    if (event.finish || event.arrival) {
      const paid = job.paid!;
      if (job.paidOutputInFlight) {
        const credited = creditJobOutput(prepared, currentJob);
        job.paid = undefined; job.paidOutputInFlight = false;
        for (const [at, keys] of credited) {
          fillBuffers(at, keys, event.tick);
          wake(inputDependencies, at, keys, event.tick);
        }
        schedule(event.job, event.tick);
        continue;
      }
      const bufferTarget = job.bufferDestination === undefined ? undefined : jobs[job.bufferDestination]!;
      const credited = job.destinationArrived ? new Map<number, string[]>() : creditJobOutput(prepared, currentJob);
      if (event.arrival) {
        job.destinationArrived = true;
        schedule(job.bufferDestination!, event.tick);
        continue;
      }
      if (transfer && state.totalCapacity !== undefined) {
        if (!job.sourceReleased)
          for (const [ware, amount] of Object.entries(paid.inputs)) add(state.reserved, ware, -amount);
        wake(spaceDependencies, job.island, Object.keys(paid.inputs), event.tick);
      }
      completedCycles[definition.uid] = own(completedCycles, definition.uid) + 1;
      options.onCompleted?.(definition, event.tick, paid.inputs, paid.outputs, paid.startTick);
      for (const release of definition.capacityReleases ?? []) {
        if ((release.at ?? "completion") !== "completion") continue;
        const at = islandIndex.get(release.islandId)!, target = states[at]!;
        const capacity = target.totalCapacity! + release.units;
        if (capacity > target.maxCapacity!) throw new Error("Saved receipt released excess shelf slots");
        target.totalCapacity = capacity;
        wake(spaceDependencies, at, [...spaceDependencies[at]!.keys()], event.tick);
      }
      job.paid = undefined;
      if (bufferTarget) {
        job.stopped = true;
        schedule(job.bufferDestination!, event.tick);
        continue;
      }
      for (const [at, keys] of credited) {
        fillBuffers(at, keys, event.tick);
        wake(inputDependencies, at, keys, event.tick);
      }
      schedule(event.job, event.tick);
      continue;
    }
    job.queued = false;
    if (!job.paidOutputUsed) {
      const paid = definition.paidOutput!;
      const at = definition.outputAccountId && paid.ware.startsWith("~") ? job.island : job.destination;
      const target = states[at]!;
      const capacity = own(target.stock, paid.ware) + own(target.reserved, paid.ware) + 1 <=
        own(target.capacities, paid.ware, Infinity) &&
        (target.totalCapacity === undefined || total(target.stock) + total(target.reserved) + 1 <= target.totalCapacity);
      if (!capacity) { job.blocked = true; continue; }
      const finishTick = event.tick + paid.ticks;
      if (finishTick > (definition.endTick ?? Infinity)) {
        job.stopped = true; continue;
      }
      integer(finishTick, "paid output finish tick");
      job.paidOutputInFlight = true; job.paidOutputUsed = true;
      job.paid = { uid: definition.uid, islandId: definition.islandId, startTick: event.tick, finishTick,
        inputs: {}, outputs: { [paid.ware]: 1 } };
      add(target.reserved, paid.ware, 1);
      queue.push({ tick: finishTick, finish: true, job: event.job, island: job.island, sequence: sequence++ });
      continue;
    }
    let finishTick = event.tick + definition.cycleTicks;
    integer(finishTick, "finish tick");
    const deadline = definition.sourceReleaseTicks === undefined && definition.destinationArrivalTicks === undefined &&
      definition.initialInputs === undefined
      ? definition.endTick ?? Infinity :
      Math.min(options.horizonTicks, definition.endTick!);
    const selectedOutputs = definition.outputSequence === undefined ? definition.outputs :
      definition.outputSequence[own(completedCycles, definition.uid)];
    if (selectedOutputs === undefined) {
      job.blocked = false;
      job.stopped = true;
      continue;
    }
    const inputs = Object.assign(record(), definition.inputs);
    const outputs = Object.assign(record(), selectedOutputs);
    if (job.sourceChoices) {
      const choice = job.sourceChoices.find(choice => own(state.stock, choice.token) > 0);
      if (!choice) { job.blocked = true; continue; }
      finishTick = event.tick + (choice.cycleTicks ?? definition.cycleTicks);
      add(inputs, choice.token, 1);
      for (const [ware, units] of Object.entries(choice.outputs ?? {})) add(outputs, ware, units);
    }
    integer(finishTick, "source finish tick");
    if (finishTick > deadline) {
      job.blocked = false;
      job.stopped = true;
      continue;
    }
    const targetGroup = definition.destinationTargetGroup;
    const remainingGroup = groupRoom(targetGroup, destination.stock, destination.reserved);
    if (definition.maxTransferUnits !== undefined) {
      const ware = Object.keys(inputs)[0]!;
      const amount = Math.max(0, Math.min(definition.maxTransferUnits,
        own(state.stock, ware) - own(definition.sourceReserves ?? {}, ware),
        own(definition.destinationTargets ?? {}, ware, Infinity) - own(destination.stock, ware) -
          own(destination.reserved, ware),
        targetGroup?.wares.includes(ware) ? remainingGroup : Infinity,
        own(destination.capacities, ware, Infinity) - own(destination.stock, ware) - own(destination.reserved, ware)));
      inputs[ware] = amount;
      outputs[ware] = amount;
      if (amount < (definition.minTransferUnits ?? 1)) { job.blocked = true; continue; }
    }
    let foodAvailable = true;
    if (definition.alternativeFoods?.length) {
      const units = definition.foodUnits ?? 1;
      const bufferedFood = definition.alternativeFoods.find(ware =>
        own(job.buffer, ware) + own(job.deliveredStock, ware) + own(job.directStock, ware) + own(job.ownedStock, ware) > 0);
      const food = definition.alternativeFoods.find(ware =>
        (bufferedFood === undefined || bufferedFood === ware) &&
        (own(definition.inputDeliveryTicks ?? {}, ware) > 0 ? 0 : own(state.stock, ware)) +
        own(job.buffer, ware) + own(job.deliveredStock, ware) + own(job.directStock, ware) +
        own(job.ownedStock, ware) >= own(inputs, ware) + units);
      if (food === undefined) foodAvailable = false;
      else add(inputs, food, units);
    }
    const available = foodAvailable && Object.entries(inputs).every(([ware, amount]) =>
      (own(definition.inputDeliveryTicks ?? {}, ware) > 0 ? 0 : own(state.stock, ware)) +
        own(job.buffer, ware) + own(job.deliveredStock, ware) + own(job.directStock, ware) + own(job.ownedStock, ware) >=
          amount + (transfer ? own(definition.sourceReserves ?? {}, ware) : 0));
    const freed = (ware: string, at: number) => transfer || at !== job.island ? 0 :
      Math.max(0, own(inputs, ware) - own(job.deliveredStock, ware) - own(job.directStock, ware) - own(job.ownedStock, ware));
    const outputTotals = new Map<number, number>();
    const wareCapacity = job.bufferDestination !== undefined || Object.entries(outputs).every(([ware, amount]) => {
      const at = outputIsland(currentJob, ware), target = states[at]!;
      outputTotals.set(at, (outputTotals.get(at) ?? 0) + amount);
      return own(target.stock, ware) - freed(ware, at) + own(target.reserved, ware) + amount <=
        Math.min(own(target.capacities, ware, Infinity),
          transfer ? own(definition.destinationTargets ?? {}, ware, Infinity) : Infinity);
    });
    const capacity = wareCapacity && [...outputTotals].every(([at, amount]) => {
      const target = states[at]!;
      return target.totalCapacity === undefined || total(target.stock) + total(target.reserved) + amount -
        Object.keys(inputs).reduce((sum, ware) => sum + freed(ware, at), 0) <= target.totalCapacity;
    });
    const groupCapacity = !targetGroup || targetGroup.wares.reduce((sum, ware) => sum + own(outputs, ware), 0) <= remainingGroup;
    if (!available || !capacity || !groupCapacity) { job.blocked = true; continue; }
    const work = definition.workTicks ?? 0;
    if (work > 0) {
      const fleet = states[job.workIsland]!;
      // Reserve fleet work in arrival order. Racing for a large token bucket lets short trips
      // repeatedly drain it and starves a distant mine forever, despite adequate total capacity.
      const planned = previewOfflineTransport(fleet, event.tick, work), ready = planned.ready;
      finishTick = definition.workOverlapsCycle ? Math.max(finishTick, ready) : ready + definition.cycleTicks;
      integer(finishTick, "transport finish tick");
      if (finishTick > deadline) {
        job.blocked = false;
        job.stopped = true;
        continue;
      }
      reserveOfflineTransport(fleet, planned);
    }
    job.blocked = false;
    job.sourceReleased = false;
    if (transfer) job.nextStart = Math.min(options.horizonTicks,
      event.tick + (definition.startIntervalTicks ?? definition.cycleTicks));
    job.paid = { uid: definition.uid, islandId: definition.islandId, startTick: event.tick,
      finishTick, inputs, outputs,
      ...(transfer ? { kind: "transfer" as const, destinationIslandId: definition.destinationIslandId } : {}) };
    spendJobInputs(prepared, currentJob, inputs);
    if (job.bufferDestination === undefined)
      for (const [ware, amount] of Object.entries(outputs)) add(states[outputIsland(currentJob, ware)]!.reserved, ware, amount);
    fillBuffers(job.island, Object.keys(inputs), event.tick);
    wake(spaceDependencies, job.island, Object.keys(inputs), event.tick);
    if (definition.sourceReleaseTicks !== undefined)
      queue.push({ tick: Math.max(event.tick, finishTick - definition.cycleTicks) + definition.sourceReleaseTicks,
        finish: false,
        sourceRelease: true, job: event.job, island: job.island, sequence: sequence++ });
    if (definition.destinationArrivalTicks !== undefined)
      queue.push({ tick: event.tick + definition.destinationArrivalTicks, finish: false, arrival: true,
        job: event.job, island: job.island, sequence: sequence++ });
    queue.push({ tick: finishTick, finish: true, job: event.job, island: job.island, sequence: sequence++ });
  }
  return finishEconomyEvents(prepared, directTrips, completedCycles, events);
};
