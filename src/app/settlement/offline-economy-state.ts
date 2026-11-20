import type { EconomyGoods, OfflineEconomyEventsOptions, OfflineEconomyPaidWork } from "./offline-economy-events";

export const integer = (value: number, name: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
};
export const goods = (value: EconomyGoods) => {
  for (const amount of Object.values(value)) integer(amount, "goods amount");
};
export const own = (record: EconomyGoods, key: string, fallback = 0): number =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key]! : fallback;
export const record = (): EconomyGoods => Object.create(null) as EconomyGoods;
export const add = (target: EconomyGoods, key: string, amount: number) => {
  const total = own(target, key) + amount;
  integer(total, "goods total");
  target[key] = total;
};
export const total = (goods: EconomyGoods) => Object.values(goods).reduce((sum, amount) => sum + amount, 0);

/** Validate and detach event ledgers and their dependency indexes before replay. */
export const createOfflineEconomyEventState = (options: OfflineEconomyEventsOptions) => {
  const states = options.islands.map(island => {
    goods(island.stock); goods(island.capacities ?? {});
    integer(island.workCapacity ?? 0, "work capacity");
    integer(island.recruitableWorkers ?? 0, "recruitable workers");
    if (island.totalCapacity !== undefined) {
      integer(island.totalCapacity, "shared capacity");
      integer(island.maxCapacity ?? island.totalCapacity, "maximum shared capacity", island.totalCapacity);
      if (total(island.stock) > island.totalCapacity) throw new Error("Initial stock exceeds shared capacity");
    }
    for (const [ware, capacity] of Object.entries(island.capacities ?? {}))
      if (own(island.stock, ware) > capacity) throw new Error("Initial stock exceeds capacity");
    return { islandId: island.islandId, ownerIslandId: island.ownerIslandId, totalCapacity: island.totalCapacity,
      maxCapacity: island.maxCapacity ?? island.totalCapacity,
      stock: Object.assign(record(), island.stock), produced: record(),
      consumed: record(), sent: record(), received: record(),
      reserved: record(), capacities: island.capacities ?? {}, workCapacity: island.workCapacity ?? 0,
      workReadyAt: 0, recruitableWorkers: island.recruitableWorkers ?? 0, recruitedWorkers: 0 };
  });
  const islandIndex = new Map(states.map((state, index) => [state.islandId, index]));
  if (islandIndex.size !== states.length) throw new Error("Duplicate island id");
  const ids = new Set<string>();
  const jobs = options.jobs.map(job => {
    integer(job.cycleTicks, "cycle ticks", 1); integer(job.firstTick ?? 0, "first tick");
    integer(job.workTicks ?? 0, "work ticks");
    if (job.sourceReleaseTicks !== undefined) {
      integer(job.sourceReleaseTicks, "source pickup ticks", 1);
      if (job.kind !== "transfer" || job.sourceReleaseTicks >= job.cycleTicks ||
        job.endTick === undefined)
        throw new Error("Source pickup requires a bounded transfer completed within the horizon");
    }
    if (job.destinationArrivalTicks !== undefined) {
      integer(job.destinationArrivalTicks, "destination arrival ticks", 1);
      if (job.kind !== "transfer" || !job.destinationBufferUid ||
        job.destinationArrivalTicks >= job.cycleTicks || job.endTick === undefined || job.workTicks)
        throw new Error("Early dropoff requires a bounded saved private receipt with a full return");
    }
    if (job.endTick !== undefined) integer(job.endTick, "end tick");
    if (job.privateRefundBuilding !== undefined) {
      integer(job.privateRefundBuilding, "private refund building");
      if (job.kind === "transfer" || !Object.keys(job.inputs).length)
        throw new Error("Private refunds require a production job with inputs");
    }
    integer(job.foodUnits ?? 1, "food units", 1); goods(job.inputs); goods(job.outputs);
    for (const output of job.outputSequence ?? []) goods(output);
    if (job.sourceChoices) {
      const { choices, input } = job.sourceChoices;
      if (job.kind === "transfer" || own(job.inputs, input) !== 1 ||
        new Set(choices.map(choice => choice.token)).size !== choices.length)
        throw new Error("Invalid finite source choices");
      for (const choice of choices) {
        goods(choice.outputs ?? {});
        if (choice.cycleTicks !== undefined) integer(choice.cycleTicks, "source cycle ticks", 1);
        if (!choice.token || own(job.inputs, choice.token) > 0 || !Number.isFinite(choice.priority) ||
          choice.priority < 0 || Object.keys(choice.outputs ?? {}).some(ware => !ware.startsWith("~")))
          throw new Error("Invalid finite source identity");
      }
    }
    goods(job.inputTargets ?? {});
    goods(job.initialInputs ?? {});
    if (job.paidOutput) {
      integer(job.paidOutput.ticks, "paid output ticks", 1);
      if (job.kind === "transfer" || !job.outputs || !Object.hasOwn(job.outputs, job.paidOutput.ware) ||
        job.paidOutput.ware.startsWith("~") || job.endTick === undefined ||
        job.paidOutput.ticks > job.endTick)
        throw new Error("Paid output requires a bounded production recipe output");
    }
    if (job.initialInputs && (job.kind === "transfer" || !job.inputTargets || job.endTick === undefined ||
      Object.keys(job.initialInputs).some(ware => !Object.hasOwn(job.inputTargets!, ware))))
      throw new Error("Owned initial inputs require a bounded private recipe buffer");
    goods(job.inputDeliveryTicks ?? {});
    if (Object.keys(job.inputDeliveryTicks ?? {}).some(ware =>
      !Object.prototype.hasOwnProperty.call(job.inputTargets ?? {}, ware)))
      throw new Error("Input delivery times require buffered recipe inputs");
    for (const [ware, delay] of Object.entries(job.inputDeliveryTicks ?? {})) {
      const required = own(job.inputs, ware) + (job.alternativeFoods?.includes(ware) ? job.foodUnits ?? 1 : 0);
      if (delay > 0 && own(job.inputTargets ?? {}, ware) < required)
        throw new Error("Input delivery buffer smaller than its recipe");
    }
    if (Object.keys(job.inputTargets ?? {}).some(ware =>
      !Object.prototype.hasOwnProperty.call(job.inputs, ware) && !job.alternativeFoods?.includes(ware)))
      throw new Error("Input targets must name recipe inputs");
    goods(job.sourceReserves ?? {}); goods(job.destinationTargets ?? {});
    const island = islandIndex.get(job.islandId);
    if (island === undefined) throw new Error("Unknown job island");
    const workIsland = islandIndex.get(job.workOwnerIslandId ?? job.islandId);
    if (workIsland === undefined) throw new Error("Unknown transport owner");
    if ((job.workTicks ?? 0) > 0 && states[workIsland]!.workCapacity === 0 &&
      states[workIsland]!.recruitableWorkers === 0)
      throw new Error("Transport work requires positive island work capacity");
    if (job.kind !== undefined && job.kind !== "production" && job.kind !== "transfer")
      throw new Error("Invalid job kind");
    let destination = island;
    if (job.kind === "transfer") {
      const target = job.destinationIslandId === undefined ? undefined : islandIndex.get(job.destinationIslandId);
      if (target === undefined || target === island) throw new Error("Invalid transfer destination");
      destination = target;
      if (job.inputTargets !== undefined) throw new Error("Transfers cannot have input targets");
      if (job.inputDeliveryTicks !== undefined) throw new Error("Transfers cannot have input delivery times");
      if (job.outputSequence !== undefined) throw new Error("Transfers cannot have an output sequence");
      if (job.alternativeFoods !== undefined) throw new Error("Transfers cannot select alternative food");
      if (job.minTransferUnits !== undefined) integer(job.minTransferUnits, "min transfer units", 1);
      if (job.startIntervalTicks !== undefined) integer(job.startIntervalTicks, "start interval ticks", 1);
      if (job.destinationTargetGroup !== undefined) {
        integer(job.destinationTargetGroup.units, "destination group units");
        const wares = job.destinationTargetGroup.wares;
        if (!Array.isArray(wares) || !wares.length || wares.some(ware => typeof ware !== "string" || !ware.length) ||
          new Set(wares).size !== wares.length) throw new Error("Invalid destination target group wares");
      }
      const keys = new Set([...Object.keys(job.inputs), ...Object.keys(job.outputs)]);
      if ([...keys].some(ware => own(job.inputs, ware) !== own(job.outputs, ware)))
        throw new Error("Transfer inputs and outputs must match");
      if (job.maxTransferUnits !== undefined) {
        integer(job.maxTransferUnits, "max transfer units", 1);
        if (keys.size !== 1 || Object.keys(job.inputs).length !== 1 || Object.keys(job.outputs).length !== 1 ||
          [...keys].some(ware => own(job.inputs, ware) !== 1 || own(job.outputs, ware) !== 1))
          throw new Error("Dynamic transfers require one matching unit ware");
      }
    } else {
      if (job.destinationIslandId !== undefined) throw new Error("Production cannot have a destination");
      if (job.destinationBufferUid !== undefined) throw new Error("Only transfers can target a private buffer");
      if (job.outputAccountId !== undefined) {
        const account = islandIndex.get(job.outputAccountId);
        if (account === undefined || states[account]!.ownerIslandId !== job.islandId)
          throw new Error("Invalid producer output account");
        destination = account;
      }
      if (job.maxTransferUnits !== undefined || job.minTransferUnits !== undefined || job.startIntervalTicks !== undefined ||
        job.sourceReserves !== undefined || job.destinationTargets !== undefined || job.destinationTargetGroup !== undefined)
        throw new Error("Transfer limits require a transfer job");
    }
    if (ids.has(job.uid)) throw new Error("Duplicate job uid");
    ids.add(job.uid);
    return { definition: job, destination, island, workIsland, paid: undefined as OfflineEconomyPaidWork | undefined,
      buffer: record(), ownedStock: Object.assign(record(), job.initialInputs),
      pendingInputs: record(), deliveredStock: record(), externalIncoming: record(),
      directStock: record(), directIncoming: record(),
      sourceChoices: job.sourceChoices?.choices.slice().sort((a, b) => a.priority - b.priority),
      bufferDestination: undefined as number | undefined,
      queued: false, blocked: false, stopped: false, sourceReleased: false, destinationArrived: false,
      paidOutputInFlight: false, paidOutputUsed: job.paidOutput === undefined,
      handledEvents: 0, nextStart: 0,
      foodTargets: Object.fromEntries((job.alternativeFoods ?? []).map(ware => [ware, own(job.inputTargets ?? {}, ware)])) };
  });
  for (const job of jobs) for (const [ware, suppliers] of Object.entries(job.definition.inputSuppliers ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(job.definition.inputTargets ?? {}, ware))
      throw new Error("Supplier requires a buffered input");
    for (const supplier of suppliers) {
      const source = islandIndex.get(supplier.accountId);
      if (source === undefined || (source !== job.island && states[source]!.ownerIslandId !== job.definition.islandId))
        throw new Error("Invalid input supplier owner");
      integer(supplier.deliveryTicks, "supplier arrival", 1); integer(supplier.workTicks, "supplier work");
      if (!Number.isFinite(supplier.routeCost) || supplier.routeCost < 0) throw new Error("Invalid supplier route cost");
      if (supplier.workTicks && states[job.workIsland]!.workCapacity === 0 &&
        states[job.workIsland]!.recruitableWorkers === 0) throw new Error("Supplier requires carrier capacity");
    }
  }
  const jobIndex = new Map(jobs.map((job, index) => [job.definition.uid, index]));
  for (const job of jobs) for (const release of job.definition.capacityReleases ?? []) {
    integer(release.units, "released shelf slots", 1);
    const target = states[islandIndex.get(release.islandId) ?? -1];
    if (job.definition.kind !== "transfer" || !target || target.totalCapacity === undefined ||
      target.ownerIslandId !== states[job.destination]!.islandId ||
      release.units > total(job.definition.inputs) ||
      ((release.at ?? "completion") === "pickup" && job.definition.sourceReleaseTicks === undefined))
      throw new Error("Invalid saved receipt shelf release");
  }
  for (const job of jobs) if (job.definition.destinationBufferUid !== undefined) {
    const index = jobIndex.get(job.definition.destinationBufferUid);
    const target = index === undefined ? undefined : jobs[index];
    if (!target || target.island !== job.destination || target.definition.kind === "transfer" ||
      target.definition.inputTargets === undefined || job.definition.maxTransferUnits !== undefined ||
      job.definition.destinationTargets !== undefined || job.definition.destinationTargetGroup !== undefined ||
      job.definition.startIntervalTicks !== undefined || Object.keys(job.definition.outputs).some(ware =>
        !Object.prototype.hasOwnProperty.call(target.definition.inputTargets, ware)))
      throw new Error("Invalid saved-delivery buffer destination");
    job.bufferDestination = index;
    for (const [ware, units] of Object.entries(job.definition.outputs)) add(target.externalIncoming, ware, units);
  }
  const inputDependencies = states.map(() => new Map<string, Set<number>>());
  const spaceDependencies = states.map(() => new Map<string, Set<number>>());
  jobs.forEach((job, index) => {
    const subscribe = (dependencies: Map<string, Set<number>>[], island: number, keys: string[]) => { for (const key of keys) {
      const map = dependencies[island]!;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(index);
    } };
    subscribe(inputDependencies, job.island, [...Object.keys(job.definition.inputs), ...(job.definition.alternativeFoods ?? [])]);
    subscribe(inputDependencies, job.island, job.sourceChoices?.map(choice => choice.token) ?? []);
    for (const [ware, suppliers] of Object.entries(job.definition.inputSuppliers ?? {}))
      for (const supplier of suppliers) subscribe(inputDependencies, islandIndex.get(supplier.accountId)!, [ware]);
    const outputKeys = [...new Set([
      ...Object.keys(job.definition.outputs),
      ...(job.definition.outputSequence ?? []).flatMap(output => Object.keys(output)),
      ...(job.definition.destinationTargetGroup?.wares ?? [])
    ])];
    for (const ware of outputKeys) {
      const at = job.definition.outputAccountId && ware.startsWith("~") ? job.island : job.destination;
      const target = states[at]!;
      // Unlimited source tokens cannot be blocked by output space. Subscribing every future
      // sapling to that pool wakes all of them on every harvest, causing quadratic retries.
      const bounded = target.totalCapacity !== undefined || Object.hasOwn(target.capacities, ware) ||
        Object.hasOwn(job.definition.destinationTargets ?? {}, ware) ||
        job.definition.destinationTargetGroup?.wares.includes(ware);
      if (bounded) subscribe(spaceDependencies, at, [ware]);
    }
  });
  return { inputDependencies, islandIndex, jobs, spaceDependencies, states };
};
