import { describe, expect, it } from "vitest";

import { type OfflineEconomyJob, runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";

describe("shared transport work", () => {
  it("uses a saved receipt at dropoff while its original courier still completes the full return", () => {
    const completions: { uid: string; tick: number }[] = [];
    const result = runOfflineEconomyEvents({ horizonTicks: 10,
      islands: [{ islandId: "home", stock: {} }, { islandId: "receipt", stock: { iron: 1 } }],
      jobs: [
        { uid: "armory", islandId: "home", cycleTicks: 2, inputs: { iron: 1 }, outputs: { sword: 1 },
          inputTargets: { iron: 1 } },
        { uid: "courier", islandId: "receipt", destinationIslandId: "home", destinationBufferUid: "armory",
          kind: "transfer", cycleTicks: 10, destinationArrivalTicks: 3, endTick: 10,
          inputs: { iron: 1 }, outputs: { iron: 1 } }
      ], onCompleted: (job, tick) => completions.push({ uid: job.uid, tick }) });
    expect(completions).toEqual([{ uid: "armory", tick: 5 }, { uid: "courier", tick: 10 }]);
    expect(result.islands[0]!.produced).toEqual({ sword: 1 });
    expect(result.islands[0]!.received).toEqual({ iron: 1 });
    expect(result.islands[1]!.sent).toEqual({ iron: 1 });
    expect(result.inProgress).toEqual([]);
  });

  it("retains original cargo if a saved receipt's full return cannot fit the actual horizon", () => {
    const result = runOfflineEconomyEvents({ horizonTicks: 5,
      islands: [{ islandId: "home", stock: {} }, { islandId: "receipt", stock: { iron: 1 } }],
      jobs: [
        { uid: "armory", islandId: "home", cycleTicks: 1, inputs: { iron: 1 }, outputs: { sword: 1 },
          inputTargets: { iron: 1 } },
        { uid: "courier", islandId: "receipt", destinationIslandId: "home", destinationBufferUid: "armory",
          kind: "transfer", cycleTicks: 10, destinationArrivalTicks: 3, endTick: 20,
          inputs: { iron: 1 }, outputs: { iron: 1 } }
      ] });
    expect(result.islands[0]!.produced).toEqual({});
    expect(result.islands[0]!.received).toEqual({});
    expect(result.islands[1]!.stock).toEqual({ iron: 1 });
    expect(result.completedCycles).toEqual({});
    expect(result.inProgress).toEqual([]);
  });

  it("rejects early dropoff without a bounded private receipt", () => {
    expect(() => runOfflineEconomyEvents({ horizonTicks: 10,
      islands: [{ islandId: "home", stock: {} }, { islandId: "receipt", stock: { iron: 1 } }],
      jobs: [{ uid: "courier", islandId: "receipt", destinationIslandId: "home", kind: "transfer",
        cycleTicks: 10, destinationArrivalTicks: 3, inputs: { iron: 1 }, outputs: { iron: 1 } }] }))
      .toThrow("Early dropoff requires a bounded saved private receipt with a full return");
  });

  const transport = (horizonTicks: number, jobs: OfflineEconomyJob[], stock = {}) =>
    runOfflineEconomyEvents({ horizonTicks, jobs, islands: [{ islandId: "home", stock, workCapacity: 2 }] });

  it("charges fleet work without serializing every worker behind a whole carrier trip", () => {
    const result = transport(12, [{ uid: "well", islandId: "home", cycleTicks: 2,
      workTicks: 8, inputs: {}, outputs: { water: 1 } }]);
    // Two carriers earn eight work ticks every four elapsed ticks; first output is at tick six.
    expect(result.islands[0]!.produced.water).toBe(2);
  });

  it("does not spend inputs while a cycle is waiting for transport capacity", () => {
    const result = transport(3, [{ uid: "mill", islandId: "home", cycleTicks: 1, endTick: 3,
      workTicks: 8, inputs: { logs: 1 }, outputs: { planks: 1 } }], { logs: 1 });
    expect(result.islands[0]!.stock.logs).toBe(1);
    expect(result.islands[0]!.consumed).toEqual({});
    expect(result.inProgress).toEqual([]);
  });

  it("shares one work budget across competing recipes", () => {
    const jobs = ["first", "second"].map(uid => ({ uid, islandId: "home", cycleTicks: 1,
      workTicks: 8, inputs: {}, outputs: { water: 1 } }));
    const result = transport(10, jobs);
    expect(result.islands[0]!.produced.water).toBe(2);
  });

  it("does not starve a long trip behind repeatedly ready short trips", () => {
    const result = transport(40, [
      { uid: "short", islandId: "home", cycleTicks: 1, workTicks: 2, inputs: {}, outputs: { water: 1 } },
      { uid: "long", islandId: "home", cycleTicks: 1, workTicks: 20, inputs: {}, outputs: { coal: 1 } }
    ]);
    expect(result.islands[0]!.produced.coal).toBeGreaterThanOrEqual(2);
    expect(result.events).toBeLessThan(40);
  });

  it("does not add transport waiting twice to a measured full cycle", () => {
    const measured = { uid: "well", islandId: "home", cycleTicks: 6, workTicks: 8,
      workOverlapsCycle: true, inputs: {}, outputs: { water: 1 } };
    expect(transport(12, [measured]).islands[0]!.produced.water).toBe(2);
    // Capacity still bounds a full cycle when the actual transport work takes longer.
    expect(transport(9, [{ ...measured, cycleTicks: 1, workTicks: 20 }]).islands[0]!.produced.water).toBeUndefined();
  });

  it("rejects work with no carrier capacity and fractional transport costs", () => {
    const definition = { uid: "bad", islandId: "home", cycleTicks: 1, workTicks: 1, inputs: {}, outputs: {} };
    expect(() => runOfflineEconomyEvents({ horizonTicks: 10, jobs: [definition],
      islands: [{ islandId: "home", stock: {} }] })).toThrow("work capacity");
    expect(() => transport(10, [{ ...definition, workTicks: .5 }])).toThrow("work ticks");
  });
});

const job = (uid: string, cycleTicks: number, inputs = {}, outputs = {}): OfflineEconomyJob =>
  ({ uid, islandId: "home", cycleTicks, inputs, outputs });
const run = (horizonTicks: number, jobs: OfflineEconomyJob[], stock = {}, capacities = {}) =>
  runOfflineEconomyEvents({ horizonTicks, jobs, islands: [{ islandId: "home", stock, capacities }] });

describe("offline economic event kernel", () => {
  it("does not retry every future maturation when an unlimited source pool loses a unit", () => {
    const future = Array.from({ length: 100 }, (_, index) =>
      job(`future:${index}`, 1, { [`unplanted:${index}`]: 1 }, { trees: 1 }));
    const result = run(100, [job("cutter", 1, { trees: 1 }, { logs: 1 }), ...future], { trees: 100 });
    expect(result.islands[0]!.produced.logs).toBe(100);
    expect(result.events).toBeLessThanOrEqual(2 * 100 + future.length + 2);
  });
  it("frees a producer shelf at physical pickup while keeping the cargo unavailable until arrival", () => {
    const completions: { uid: string; tick: number }[] = [];
    const result = runOfflineEconomyEvents({ horizonTicks: 10,
      islands: [{ islandId: "home", stock: {} },
        { islandId: "yard", ownerIslandId: "home", stock: { water: 1 }, totalCapacity: 1 }],
      jobs: [
        { uid: "well", islandId: "home", outputAccountId: "yard", cycleTicks: 1, endTick: 10,
          inputs: {}, outputs: { water: 1 } },
        { uid: "courier", islandId: "yard", destinationIslandId: "home", kind: "transfer",
          cycleTicks: 5, sourceReleaseTicks: 1, endTick: 10, inputs: { water: 1 }, outputs: { water: 1 } }
      ], onCompleted: (job, tick) => completions.push({ uid: job.uid, tick }) });
    expect(completions[0]).toEqual({ uid: "well", tick: 2 });
    expect(completions.find(entry => entry.uid === "courier")?.tick).toBe(5);
    expect(result.islands[0]!.stock.water).toBe(2);
    expect(result.islands[0]!.produced.water).toBe(2);
    expect(result.islands[1]!.stock.water).toBe(1);
    expect(result.inProgress).toEqual([]);
  });

  it("never starts an export whose released shelf could not receive refunded cargo at cutoff", () => {
    const result = runOfflineEconomyEvents({ horizonTicks: 4,
      islands: [{ islandId: "home", stock: {} },
        { islandId: "yard", ownerIslandId: "home", stock: { water: 1 }, totalCapacity: 1 }],
      jobs: [{ uid: "courier", islandId: "yard", destinationIslandId: "home", kind: "transfer",
        cycleTicks: 5, sourceReleaseTicks: 1, endTick: 10, inputs: { water: 1 }, outputs: { water: 1 } }] });
    expect(result.islands[1]!.stock.water).toBe(1);
    expect(result.inProgress).toEqual([]);
    expect(result.completedCycles).toEqual({});
  });
  it("credits an original paid worker output once before the planned sequence", () => {
    const job: OfflineEconomyJob = { uid: "armory", islandId: "home", cycleTicks: 3,
      inputs: { iron: 1, coal: 1 }, outputs: { sword: 0, axe: 0 },
      outputSequence: [{ axe: 1 }, { sword: 1 }], paidOutput: { ware: "sword", ticks: 1 },
      endTick: 10 };
    const result = run(2, [job], { iron: 1, coal: 1 });
    expect(result.islands[0]!.stock).toMatchObject({ sword: 1 });
    expect(result.islands[0]!.consumed).toEqual({ iron: 1, coal: 1 });
    expect(result.completedCycles).toEqual({});
    // The normal sequence is unchanged by the already-paid receipt.
    expect(result.inProgress).toHaveLength(1);
  });

  it("rejects a paid output outside the bounded receipt completion interval", () => {
    expect(() => runOfflineEconomyEvents({ horizonTicks: 1,
      islands: [{ islandId: "home", stock: { iron: 2, coal: 2 } }],
      jobs: [{ uid: "armory", islandId: "home", cycleTicks: 3, endTick: 1,
        inputs: { iron: 1, coal: 1 }, outputs: { sword: 1 },
        paidOutput: { ware: "sword", ticks: 8 }, outputSequence: [{ sword: 1 }] }] }))
      .toThrow("Paid output requires a bounded production recipe output");
  });

  it("releases a saved receipt shelf at pickup before its full return", () => {
    const result = runOfflineEconomyEvents({ horizonTicks: 10,
      islands: [{ islandId: "home", stock: {} },
        { islandId: "yard", ownerIslandId: "home", stock: {}, totalCapacity: 0, maxCapacity: 1 },
        { islandId: "receipt", stock: { water: 1 } }],
      jobs: [
        { uid: "well", islandId: "home", outputAccountId: "yard", cycleTicks: 1, endTick: 10,
          inputs: {}, outputs: { water: 1 } },
        { uid: "courier", islandId: "receipt", destinationIslandId: "home", kind: "transfer",
          cycleTicks: 8, sourceReleaseTicks: 2, endTick: 10, inputs: { water: 1 }, outputs: { water: 1 },
          capacityReleases: [{ islandId: "yard", units: 1, at: "pickup" }] }
      ] });
    expect(result.islands[0]!.stock.water).toBe(1);
    expect(result.islands[1]!.stock.water).toBe(1);
    expect(result.completedCycles).toMatchObject({ well: 1, courier: 1 });
  });

  it("preserves every production stage's lead time", () => {
    const jobs = [job("mill", 3, { logs: 1 }, { planks: 1 }), job("forest", 2, {}, { logs: 1 })];
    expect(run(4, jobs).islands[0]!.produced.planks ?? 0).toBe(0);
    expect(run(4, jobs).inProgress.find(work => work.uid === "mill")?.finishTick).toBe(5);
    expect(run(5, jobs).islands[0]!.produced.planks).toBe(1);
  });
  it("allocates scarce stock atomically in insertion order", () => {
    const result = run(10, [job("first", 2, { logs: 1 }, { planks: 1 }),
      job("second", 2, { logs: 1 }, { coal: 1 })], { logs: 1 });
    expect(result.islands[0]!.stock).toEqual({ logs: 0, planks: 1 });
    expect(result.islands[0]!.consumed).toEqual({ logs: 1 });
    expect(result.completedCycles).toEqual({ first: 1 });
  });
  it("switches to the next available alternative food", () => {
    const mine = { ...job("mine", 2, { "~ore": 1 }, { ironOre: 1 }), alternativeFoods: ["fish", "meat"] };
    const result = run(6, [mine], { "~ore": 10, fish: 1, meat: 2 });
    expect(result.islands[0]!.produced).toEqual({ ironOre: 3 });
    expect(result.islands[0]!.consumed).toEqual({ "~ore": 3, fish: 1, meat: 2 });
  });
  it("stops at finite depletion without negative stock", () => {
    const result = run(100, [job("mine", 1, { "~ore": 1 }, { ironOre: 1 })], { "~ore": 3 });
    expect(result.completedCycles.mine).toBe(3);
    expect(result.islands[0]!.stock).toEqual({ "~ore": 0, ironOre: 3 });
    expect(result.inProgress).toEqual([]);
  });
  it("tracks paid work beyond the horizon and credits completions at the horizon", () => {
    const mill = job("mill", 5, { logs: 2 }, { planks: 1 });
    const result = run(4, [mill], { logs: 4 });
    expect(result.islands[0]!.stock.logs).toBe(2);
    expect(result.islands[0]!.consumed.logs).toBe(2);
    expect(result.islands[0]!.produced).toEqual({});
    expect(result.inProgress).toEqual([{ uid: "mill", islandId: "home", startTick: 0,
      finishTick: 5, inputs: { logs: 2 }, outputs: { planks: 1 } }]);
    expect(run(5, [mill], { logs: 4 })).toMatchObject({ inProgress: [],
      islands: [{ stock: { logs: 2, planks: 1 } }] });
  });
  it("reserves shared output capacity across simultaneous jobs", () => {
    const result = run(10, [job("first", 2, {}, { water: 1 }), job("second", 3, {}, { water: 1 })],
      {}, { water: 1 });
    expect(result.islands[0]!.produced.water).toBe(1);
    expect(result.completedCycles).toEqual({ first: 1 });
  });
  it("wakes capacity-blocked producers when storage is consumed", () => {
    const consumer = { ...job("consumer", 1, { water: 1 }, { bread: 1 }), firstTick: 3 };
    const result = run(6, [job("well", 2, {}, { water: 1 }), consumer], {}, { water: 1 });
    expect(result.islands[0]!.produced).toEqual({ water: 2, bread: 2 });
    expect(result.completedCycles).toEqual({ well: 2, consumer: 2 });
  });
  it("is deterministic, isolates islands, and leaves its input untouched", () => {
    const options = { horizonTicks: 5,
      islands: [{ islandId: "home", stock: { logs: 1 } }, { islandId: "colony", stock: { logs: 2 } }],
      jobs: [job("home-mill", 2, { logs: 1 }, { planks: 1 }),
        { ...job("colony-mill", 2, { logs: 1 }, { planks: 1 }), islandId: "colony" }] };
    const source = JSON.stringify(options);
    expect(runOfflineEconomyEvents(options)).toEqual(runOfflineEconomyEvents(options));
    expect(JSON.stringify(options)).toBe(source);
    expect(runOfflineEconomyEvents(options).islands.map(island => island.produced.planks)).toEqual([1, 2]);
  });
  it("rejects instantaneous cycles and fractional tick or stock values", () => {
    expect(() => run(10, [job("bad", 0)])).toThrow("cycle ticks");
    expect(() => run(.5, [])).toThrow("horizon");
    expect(() => run(5, [], { logs: .5 })).toThrow("goods");
    expect(run(0, [job("idle", 1)])).toMatchObject({ events: 0, inProgress: [] });
  });
});

const transfer = (uid: string, cycleTicks = 3): OfflineEconomyJob => ({
  ...job(uid, cycleTicks, { logs: 1 }, { logs: 1 }), kind: "transfer", destinationIslandId: "colony"
});
const shipping = (horizonTicks: number, jobs: OfflineEconomyJob[], colonyLogs = 0, capacity = 10) =>
  runOfflineEconomyEvents({ horizonTicks, jobs, islands: [
    { islandId: "home", stock: { logs: 1 } },
    { islandId: "colony", stock: { logs: colonyLogs }, capacities: { logs: capacity } }
  ] });

describe("offline economic transfers and event budget", () => {
  it("holds conserved cargo in flight until arrival, without counting production or consumption", () => {
    const early = shipping(2, [transfer("ship")]);
    expect(early.islands.map(island => island.stock.logs)).toEqual([0, 0]);
    expect(early.inProgress).toEqual([{ uid: "ship", islandId: "home", destinationIslandId: "colony",
      kind: "transfer", startTick: 0, finishTick: 3, inputs: { logs: 1 }, outputs: { logs: 1 } }]);
    expect(early.islands[0]!.sent).toEqual({ logs: 1 });
    expect(early.islands[1]!.received).toEqual({});
    const arrived = shipping(3, [transfer("ship")]);
    expect(arrived.islands.map(island => island.stock.logs)).toEqual([0, 1]);
    expect(arrived.islands[1]!.received).toEqual({ logs: 1 });
    expect(arrived.inProgress).toEqual([]);
    expect(arrived.completedCycles.ship).toBe(1);
    for (const island of arrived.islands) {
      expect(island.produced).toEqual({}); expect(island.consumed).toEqual({});
    }
  });
  it("does not send the same source stock on two ships", () => {
    const result = shipping(8, [transfer("first"), transfer("second")]);
    expect(result.completedCycles).toEqual({ first: 1 });
    expect(result.islands[0]!.sent).toEqual({ logs: 1 });
    expect(result.islands[1]!.received).toEqual({ logs: 1 });
  });
  it("blocks on destination capacity and wakes when a destination consumer frees it", () => {
    const mill = { ...job("mill", 1, { logs: 1 }, { planks: 1 }), islandId: "colony", firstTick: 2 };
    const result = shipping(5, [transfer("ship"), mill], 1, 1);
    expect(result.islands[0]!.sent).toEqual({ logs: 1 });
    expect(result.islands[1]!.received).toEqual({ logs: 1 });
    expect(result.islands[1]!.produced).toEqual({ planks: 1 });
    expect(result.islands[1]!.stock.logs).toBe(1);
    expect(result.completedCycles).toEqual({ mill: 1, ship: 1 });
  });
  it("reserves destination space across competing departures", () => {
    const result = runOfflineEconomyEvents({ horizonTicks: 4,
      islands: [{ islandId: "home", stock: { logs: 2 } },
        { islandId: "colony", stock: {}, capacities: { logs: 1 } }],
      jobs: [transfer("first"), transfer("second")] });
    expect(result.completedCycles).toEqual({ first: 1 });
    expect(result.islands[0]!.stock.logs).toBe(1);
    expect(result.islands[1]!.stock.logs).toBe(1);
  });
  it("rejects nonconserved transfers, food selection, and cross-island production", () => {
    expect(() => shipping(3, [{ ...transfer("bad"), outputs: { logs: 2 } }])).toThrow("must match");
    expect(() => shipping(3, [{ ...transfer("bad"), alternativeFoods: [] }])).toThrow("alternative food");
    expect(() => shipping(3, [{ ...transfer("bad"), kind: "production" }])).toThrow("destination");
    expect(() => shipping(3, [{ ...transfer("bad"), destinationIslandId: "missing" }])).toThrow("destination");
  });
  it("throws at a deterministic work limit without mutating its input", () => {
    const options = { horizonTicks: 20, maxEvents: 2, jobs: [job("well", 1, {}, { water: 1 })],
      islands: [{ islandId: "home", stock: {} }] };
    const source = JSON.stringify(options);
    for (let repeat = 0; repeat < 2; repeat++)
      expect(() => runOfflineEconomyEvents(options)).toThrow("event budget exceeded (2)");
    expect(JSON.stringify(options)).toBe(source);
    // A start at tick zero followed by completion at the horizon needs exactly two events.
    expect(runOfflineEconomyEvents({ ...options, horizonTicks: 1 }).events).toBe(2);
    for (const maxEvents of [0, -1, .5, Infinity])
      expect(() => runOfflineEconomyEvents({ ...options, maxEvents })).toThrow("max events");
  });
});


describe("offline transfer limits", () => {
  const dynamic = (uid = "ship"): OfflineEconomyJob => ({ ...transfer(uid), maxTransferUnits: 40,
    destinationTargets: { logs: 5 } });
  const simulate = (jobs: OfflineEconomyJob[], sourceLogs = 3, horizonTicks = 3, maxEvents = 100) =>
    runOfflineEconomyEvents({ horizonTicks, maxEvents, jobs, islands: [
      { islandId: "home", stock: { logs: sourceLogs } },
      { islandId: "colony", stock: {}, capacities: { logs: 100 } }
    ] });

  it("sends a partial cargo from unit input and output definitions", () => {
    const result = simulate([dynamic()]);
    expect(result.islands[0]!.sent).toEqual({ logs: 3 });
    expect(result.islands[1]!.received).toEqual({ logs: 3 });
    expect(result.completedCycles).toEqual({ ship: 1 });
    expect(simulate([dynamic()], 3, 2).inProgress[0]).toMatchObject({
      inputs: { logs: 3 }, outputs: { logs: 3 }
    });
  });

  it("counts in-flight cargo toward target supply", () => {
    const result = simulate([dynamic("first"), dynamic("second")], 20);
    expect(result.islands[0]!.sent).toEqual({ logs: 5 });
    expect(result.completedCycles).toEqual({ first: 1 });
    expect(result.islands[0]!.stock.logs).toBe(15);
  });

  it("retains reserves for dynamic and fixed cargo", () => {
    expect(simulate([{ ...dynamic(), sourceReserves: { logs: 2 } }]).islands[0]!.sent).toEqual({ logs: 1 });
    expect(simulate([{ ...transfer("fixed"), sourceReserves: { logs: 3 } }]).islands[0]!.sent).toEqual({});
    expect(simulate([{ ...transfer("fixed"), sourceReserves: { logs: 2 } }]).islands[0]!.stock.logs).toBe(2);
  });

  it("limits dynamic cargo to actual storage capacity", () => {
    const result = runOfflineEconomyEvents({ horizonTicks: 3, jobs: [dynamic()], islands: [
      { islandId: "home", stock: { logs: 20 } },
      { islandId: "colony", stock: { logs: 1 }, capacities: { logs: 2 } }
    ] });
    expect(result.islands[0]!.sent).toEqual({ logs: 1 });
  });

  it("wakes target-blocked ships when destination stock is consumed", () => {
    const consumer = { ...job("mill", 1, { logs: 1 }, { planks: 1 }), islandId: "colony", firstTick: 4 };
    const result = simulate([{ ...dynamic(), destinationTargets: { logs: 1 } }, consumer], 3, 7);
    expect(result.islands[0]!.sent).toEqual({ logs: 2 });
    expect(result.islands[1]!.received).toEqual({ logs: 2 });
  });

  it("wakes source-blocked ships when production credits new stock", () => {
    const result = simulate([dynamic(), job("forest", 2, {}, { logs: 1 })], 0, 6);
    expect(result.islands[0]!.sent).toEqual({ logs: 2 });
    expect(result.islands[1]!.received).toEqual({ logs: 1 });
  });

  it("does not wake input waiters on other consumers' payments", () => {
    const options = { horizonTicks: 1, maxEvents: 3,
      islands: [{ islandId: "home", stock: { logs: 1 } }],
      jobs: [job("waiting", 1, { logs: 2 }, {}), job("consumer", 2, { logs: 1 }, {})] };
    // Waiting start, consumer start, then the beyond-horizon completion is ignored.
    expect(runOfflineEconomyEvents({ ...options, maxEvents: 2 }).events).toBe(2);
    expect(() => simulate([dynamic()], 3, 3, 1)).toThrow("event budget exceeded");
    expect(simulate([dynamic()], 3, 3, 2).events).toBe(2);
  });

  it("recycles the same ware without falsely exhausting storage", () => {
    const result = run(4, [job("recycle", 1, { logs: 1 }, { logs: 1 })], { logs: 1 }, { logs: 1 });
    expect(result.completedCycles).toEqual({ recycle: 4 });
    expect(result.islands[0]!.stock).toEqual({ logs: 1 });
  });

  it("supports prototype-named wares and job ids without inherited stock", () => {
    const odd = Object.fromEntries([["__proto__", 1], ["toString", 1]]);
    const result = run(1, [job("__proto__", 1, odd, odd)], odd, odd);
    expect(Object.entries(result.completedCycles)).toEqual([["__proto__", 1]]);
    expect(Object.entries(result.islands[0]!.produced)).toEqual(Object.entries(odd));
    expect(run(1, [job("toString", 1, { toString: 1 }, {})]).completedCycles).toEqual({});
    const output = run(1, [job("toString", 1, {}, Object.fromEntries([["__proto__", 1]]))]);
    expect(output.completedCycles.toString).toBe(1);
    expect(Object.entries(output.islands[0]!.stock)).toEqual([["__proto__", 1]]);
  });

  it("validates transfer-only dynamic limits and unit cargo", () => {
    expect(() => simulate([{ ...dynamic(), maxTransferUnits: 0 }])).toThrow("max transfer units");
    expect(() => simulate([{ ...dynamic(), inputs: { logs: 2 }, outputs: { logs: 2 } }])).toThrow("unit ware");
    expect(() => simulate([{ ...dynamic(), inputs: {}, outputs: {} }])).toThrow("unit ware");
    expect(() => simulate([{ ...job("invalid", 1), maxTransferUnits: 2 }])).toThrow("require a transfer");
    expect(() => simulate([{ ...dynamic(), sourceReserves: { logs: -1 } }])).toThrow("goods amount");
  });
});


describe("offline job expiry", () => {
  it("ends one island's work without consuming a cycle beyond its completion deadline", () => {
    const result = runOfflineEconomyEvents({ horizonTicks: 9, islands: [
      { islandId: "home", stock: { logs: 5 } },
      { islandId: "colony", stock: { logs: 5 } }
    ], jobs: [
      { ...job("expiring", 2, { logs: 1 }, { planks: 1 }), endTick: 5 },
      { ...job("continuing", 2, { logs: 1 }, { planks: 1 }), islandId: "colony" }
    ] });
    expect(result.completedCycles).toEqual({ expiring: 2, continuing: 4 });
    expect(result.islands[0]).toMatchObject({ stock: { logs: 3, planks: 2 }, consumed: { logs: 2 } });
    expect(result.inProgress).toEqual([expect.objectContaining({ uid: "continuing", finishTick: 10 })]);
    expect(run(4, [{ ...job("deadline", 2, { logs: 1 }, { planks: 1 }), endTick: 4 }], { logs: 3 })
      .completedCycles).toEqual({ deadline: 2 });
  });

  it("rejects invalid expiry and never starts at expiry", () => {
    for (const endTick of [-1, 1.5, Infinity])
      expect(() => run(5, [{ ...job("invalid", 1), endTick }])).toThrow("end tick");
    expect(run(5, [{ ...job("idle", 1), firstTick: 2, endTick: 2 }]).events).toBe(0);
    expect(run(5, [{ ...job("idle", 1), endTick: 0 }]).events).toBe(0);
  });
});


describe("offline production output sequences", () => {
  it("can produce the first tool with scarce materials despite a longer product rotation", () => {
    const tools = ["axe", "pickaxe", "hammer", "saw", "shovel", "scythe", "fishingRod",
      "tongs", "hoe", "cleaver", "rollingPin", "bucket", "needle"];
    const result = run(20, [{ ...job("toolsmith", 2, { iron: 1, planks: 1 }, {}),
      outputSequence: tools.map(tool => ({ [tool]: 1 })) }], { iron: 1, planks: 1 });
    expect(result.completedCycles).toEqual({ toolsmith: 1 });
    expect(result.islands[0]!.produced).toEqual({ axe: 1 });
    expect(result.islands[0]!.consumed).toEqual({ iron: 1, planks: 1 });
  });

  it("stops an exhausted sequence without paying for future work", () => {
    const result = run(20, [{ ...job("tools", 2, { iron: 1 }, { unused: 1 }),
      outputSequence: [{ axe: 1 }, { pickaxe: 1 }] }], { iron: 5 });
    expect(result.completedCycles).toEqual({ tools: 2 });
    expect(result.islands[0]!.stock).toEqual({ iron: 3, axe: 1, pickaxe: 1 });
    expect(result.inProgress).toEqual([]);
    const empty = run(20, [{ ...job("empty", 1, { iron: 1 }, { unused: 1 }),
      outputSequence: [] }], { iron: 5 });
    expect(empty.islands[0]!.stock).toEqual({ iron: 5 });
    expect(empty.inProgress).toEqual([]);
  });

  it("checks capacity for the current output and wakes on its ware's consumption", () => {
    const producer: OfflineEconomyJob = { ...job("tools", 1, { iron: 1 }, { unused: 1 }),
      outputSequence: [{ axe: 1 }, { pickaxe: 1 }] };
    const consumer = { ...job("use-pickaxe", 5, { pickaxe: 1 }, {}), firstTick: 3 };
    const result = run(5, [producer, consumer], { iron: 3, pickaxe: 1 },
      { axe: 1, pickaxe: 1, unused: 0 });
    expect(result.completedCycles).toEqual({ tools: 2 });
    expect(result.islands[0]!.produced).toEqual({ axe: 1, pickaxe: 1 });
    expect(result.islands[0]!.stock.iron).toBe(1);
    expect(result.inProgress).toEqual([expect.objectContaining({ uid: "use-pickaxe" })]);
  });

  it("validates every output and rejects transfer sequences", () => {
    expect(() => run(5, [{ ...job("bad", 1), outputSequence: [{ axe: 1 }, { pickaxe: -1 }] }]))
      .toThrow("goods amount");
    expect(() => shipping(5, [{ ...transfer("bad"), outputSequence: [] }]))
      .toThrow("cannot have an output sequence");
  });
});

describe("offline pooled transfer targets and departure cadence", () => {
  const foods = ["fish", "meat", "bread"];
  const supply = (ware: string, overrides: Partial<OfflineEconomyJob> = {}): OfflineEconomyJob => ({
    ...job(`supply:${ware}`, 3, { [ware]: 1 }, { [ware]: 1 }), kind: "transfer",
    destinationIslandId: "colony", maxTransferUnits: 40,
    destinationTargetGroup: { wares: foods, units: 12 }, ...overrides
  });
  const simulate = (jobs: OfflineEconomyJob[], stock = { fish: 20, meat: 20, bread: 20 },
    colonyStock = {}, horizonTicks = 3) => runOfflineEconomyEvents({ horizonTicks, jobs, islands: [
      { islandId: "home", stock }, { islandId: "colony", stock: colonyStock }
    ] });

  it("lets one available food fill the entire pooled food buffer", () => {
    const result = simulate(foods.map(ware => supply(ware)), { fish: 20, meat: 0, bread: 0 });
    expect(result.islands[0]!.sent).toEqual({ fish: 12 });
    expect(result.islands[1]!.received).toEqual({ fish: 12 });
    expect(result.islands[0]!.stock.fish).toBe(8);
  });

  it("counts other food shipments already in flight toward the same target", () => {
    const jobs = foods.map(ware => supply(ware));
    const early = simulate(jobs, undefined, {}, 2);
    expect(early.inProgress).toHaveLength(1);
    expect(early.inProgress[0]!.outputs).toEqual({ fish: 12 });
    expect(early.islands[0]!.sent).toEqual({ fish: 12 });
    const result = simulate(jobs);
    expect(result.islands[1]!.received).toEqual({ fish: 12 });
    expect(result.completedCycles).toEqual({ "supply:fish": 1 });
  });

  it("wakes a fish shipment when a consumer spends a different grouped food", () => {
    const consumer = { ...job("eat-meat", 10, { meat: 2 }, {}), islandId: "colony", firstTick: 1 };
    const result = simulate([supply("fish"), consumer], undefined, { meat: 12 }, 4);
    expect(result.islands[0]!.sent).toEqual({ fish: 2 });
    expect(result.islands[1]!.received).toEqual({ fish: 2 });
    expect(result.islands[1]!.stock).toEqual({ meat: 10, fish: 2 });
  });

  it("enforces pooled targets for fixed cargo and blocks zero target units", () => {
    const fixed = foods.map(ware => supply(ware, { maxTransferUnits: undefined,
      destinationTargetGroup: { wares: foods, units: 1 } }));
    expect(simulate(fixed).islands[1]!.received).toEqual({ fish: 1 });
    expect(simulate([supply("fish", { destinationTargetGroup: { wares: foods, units: 0 } })])
      .islands[0]!.sent).toEqual({});
  });

  it("waits for a full minimum batch rather than departing with scarce partial cargo", () => {
    const ship = { ...transfer("ore-ship"), maxTransferUnits: 80, minTransferUnits: 80 };
    const producer = { ...job("last-ore", 2, {}, {}), outputSequence: [{ logs: 1 }] };
    const result = runOfflineEconomyEvents({ horizonTicks: 5, jobs: [ship, producer], islands: [
      { islandId: "home", stock: { logs: 79 } }, { islandId: "colony", stock: {} }
    ] });
    expect(result.islands[0]!.sent).toEqual({ logs: 80 });
    expect(result.islands[1]!.received).toEqual({ logs: 80 });
    expect(result.completedCycles).toEqual({ "last-ore": 1, "ore-ship": 1 });
  });

  it("spaces successive departures from their start times despite faster voyages", () => {
    const result = runOfflineEconomyEvents({ horizonTicks: 6, jobs: [
      { ...transfer("hourly", 1), startIntervalTicks: 5 }
    ], islands: [{ islandId: "home", stock: { logs: 5 } }, { islandId: "colony", stock: {} }] });
    expect(result.completedCycles.hourly).toBe(2);
    expect(result.islands[0]!.sent).toEqual({ logs: 2 });
    expect(result.islands[1]!.received).toEqual({ logs: 2 });
    expect(result.islands[0]!.stock.logs).toBe(3);
  });

  it("validates grouped targets, minimum batches and transfer-only cadence", () => {
    for (const units of [-1, .5, Infinity])
      expect(() => simulate([supply("fish", { destinationTargetGroup: { wares: foods, units } })]))
        .toThrow("destination group units");
    for (const wares of [[], ["fish", "fish"], [""]])
      expect(() => simulate([supply("fish", { destinationTargetGroup: { wares, units: 1 } })]))
        .toThrow("group wares");
    for (const minimum of [0, -1, .5])
      expect(() => simulate([supply("fish", { minTransferUnits: minimum })])).toThrow("min transfer units");
    for (const interval of [0, -1, .5, Infinity])
      expect(() => simulate([supply("fish", { startIntervalTicks: interval })])).toThrow("start interval ticks");
    expect(() => run(3, [{ ...job("bad", 1), destinationTargetGroup: { wares: foods, units: 1 } }]))
      .toThrow("require a transfer");
    expect(() => run(3, [{ ...job("bad", 1), startIntervalTicks: 3 }])).toThrow("require a transfer");
  });
});

describe("offline production input buffers", () => {
  it("delivers held cargo to its promised workshop without another warehouse reservation", () => {
    const mill = { ...job("mill", 2, { grain: 1 }, { flour: 1 }), inputTargets: { grain: 2 },
      inputDeliveryTicks: { grain: 100 } };
    const cargo = { uid: "held-grain", islandId: "held", kind: "transfer" as const,
      destinationIslandId: "home", destinationBufferUid: "mill", cycleTicks: 5,
      inputs: { grain: 1 }, outputs: { grain: 1 } };
    const simulate = (horizonTicks: number) => runOfflineEconomyEvents({ horizonTicks, jobs: [mill, cargo],
      islands: [{ islandId: "home", stock: {}, capacities: { grain: 0, flour: 1 } },
        { islandId: "held", stock: { grain: 1 } }] });
    expect(simulate(4).islands[0]!.produced).toEqual({});
    expect(simulate(6).buffers[0]!.deliveredStock).toBeUndefined();
    const result = simulate(7);
    expect(result.completedCycles).toEqual({ "held-grain": 1, mill: 1 });
    expect(result.islands[0]!.stock).toEqual({ flour: 1, grain: 0 });
    expect(result.islands[0]!.consumed).toEqual({ grain: 1 });
    expect(result.islands[0]!.received).toEqual({ grain: 1 });
  });
  it("keeps unconsumed saved deliveries separate from warehouse-backed buffers", () => {
    const recipe = { ...job("tools", 2, { iron: 1, planks: 1 }, { axe: 1 }),
      inputTargets: { iron: 2, planks: 2 } };
    const delivery = { uid: "held-iron", islandId: "held", kind: "transfer" as const,
      destinationIslandId: "home", destinationBufferUid: "tools", cycleTicks: 1,
      inputs: { iron: 1 }, outputs: { iron: 1 } };
    const result = runOfflineEconomyEvents({ horizonTicks: 5, jobs: [recipe, delivery],
      islands: [{ islandId: "home", stock: {} }, { islandId: "held", stock: { iron: 1 } }] });
    expect(result.islands[0]!.stock.iron ?? 0).toBe(0);
    expect(result.islands[0]!.consumed).toEqual({});
    expect(result.buffers[0]!.deliveredStock).toEqual({ iron: 1 });
    expect(result.buffers[0]!.stock).toEqual({});
  });
  it("counts saved incoming food and never allocates it to competing consumers", () => {
    const mine = { ...job("mine", 1, { "~ore": 1 }, { iron: 1 }), alternativeFoods: ["fish", "bread"],
      inputTargets: { fish: 2, bread: 2 }, inputDeliveryTicks: { fish: 2, bread: 2 } };
    const food = { uid: "held-food", islandId: "held", kind: "transfer" as const,
      destinationIslandId: "home", destinationBufferUid: "mine", cycleTicks: 4,
      inputs: { fish: 1 }, outputs: { fish: 1 } };
    const competitor = job("eat", 1, { fish: 1 }, { meat: 1 });
    const result = runOfflineEconomyEvents({ horizonTicks: 5, jobs: [mine, competitor, food],
      islands: [{ islandId: "home", stock: { "~ore": 1, bread: 3 } },
        { islandId: "held", stock: { fish: 1 } }] });
    expect(result.islands[0]!.produced).toEqual({ iron: 1 });
    expect(result.islands[0]!.consumed).toEqual({ "~ore": 1, fish: 1 });
    expect(result.islands[0]!.stock.bread).toBe(3);
  });
  it("does not free warehouse space by consuming external private inputs", () => {
    const recycle = { ...job("recycle", 1, { logs: 1 }, { logs: 1 }), inputTargets: { logs: 1 } };
    const delivery = { uid: "held-log", islandId: "held", kind: "transfer" as const,
      destinationIslandId: "home", destinationBufferUid: "recycle", cycleTicks: 1,
      inputs: { logs: 1 }, outputs: { logs: 1 } };
    const result = runOfflineEconomyEvents({ horizonTicks: 4, jobs: [recycle, delivery],
      islands: [{ islandId: "home", stock: {}, capacities: { logs: 0 } },
        { islandId: "held", stock: { logs: 1 } }] });
    expect(result.islands[0]!.produced).toEqual({});
    expect(result.buffers[0]!.deliveredStock).toEqual({ logs: 1 });
  });
  it("waits for physical delivery even while the warehouse has more inputs", () => {
    const mill = { ...job("mill", 2, { grain: 1 }, { flour: 1 }), inputTargets: { grain: 1 },
      inputDeliveryTicks: { grain: 5 } };
    const early = run(4, [mill], { grain: 3 });
    expect(early.islands[0]!.consumed).toEqual({});
    expect(early.buffers[0]!.stock).toEqual({ grain: 1 });
    expect(early.islands[0]!.stock.grain).toBe(2);
    const atCompletion = run(7, [mill], { grain: 3 });
    expect(atCompletion.completedCycles.mill).toBe(1);
    expect(atCompletion.islands[0]!.produced).toEqual({ flour: 1 });
    expect(atCompletion.inProgress).toEqual([]);
    expect((atCompletion.islands[0]!.stock.grain ?? 0) +
      (atCompletion.buffers[0]!.stock.grain ?? 0) + (atCompletion.islands[0]!.consumed.grain ?? 0)).toBe(3);
  });
  it("counts in-flight inputs toward targets and retains their ownership at cutoff", () => {
    const recipe = { ...job("tools", 2, { iron: 1, planks: 1 }, { axe: 1 }),
      inputTargets: { iron: 2, planks: 2 }, inputDeliveryTicks: { iron: 5, planks: 20 } };
    const result = run(8, [recipe, job("more-iron", 1, {}, { iron: 1 })], { iron: 3, planks: 2 });
    expect(result.islands[0]!.consumed).toEqual({});
    expect(result.buffers[0]!.stock).toEqual({ iron: 2, planks: 2 });
    expect(result.islands[0]!.stock.iron).toBe(9);
    expect(result.islands[0]!.stock.planks).toBe(0);
  });
  it("keeps one alternative food type across pending and arrived deliveries", () => {
    const mine = { ...job("mine", 1, { "~ore": 1 }, { iron: 1 }), alternativeFoods: ["fish", "bread"],
      inputTargets: { fish: 2, bread: 2 }, inputDeliveryTicks: { fish: 4, bread: 1 } };
    const early = run(3, [mine], { "~ore": 5, fish: 2, bread: 5 });
    expect(early.islands[0]!.consumed).toEqual({});
    expect(early.buffers[0]!.stock).toEqual({ fish: 1 });
    expect(early.islands[0]!.stock.bread).toBe(5);
    const later = run(10, [mine], { "~ore": 5, fish: 2, bread: 5 });
    expect(later.completedCycles.mine).toBe(3);
    expect(later.islands[0]!.consumed).toEqual({ "~ore": 3, fish: 2, bread: 1 });
    expect(later.islands[0]!.stock.bread).toBe(4);
  });
  it("does not reserve deliveries that cannot fund work before its expiry", () => {
    const mill = { ...job("mill", 3, { grain: 1 }, { flour: 1 }), endTick: 7,
      inputTargets: { grain: 2 }, inputDeliveryTicks: { grain: 5 } };
    expect(run(10, [mill], { grain: 3 }).islands[0]!.stock.grain).toBe(3);
    expect(() => run(10, [{ ...mill, inputDeliveryTicks: { grain: -.5 } }], { grain: 3 }))
      .toThrow("goods amount");
    expect(() => run(10, [{ ...mill, inputDeliveryTicks: { water: 1 } }], { grain: 3 }))
      .toThrow("buffered recipe inputs");
    expect(() => run(10, [{ ...mill, inputs: { grain: 3 } }], { grain: 3 }))
      .toThrow("buffer smaller than its recipe");
  });
  it("refills a working higher-priority producer before lower-priority consumers", () => {
    const grain = job("farm", 2, {}, { grain: 1 });
    const mill = job("mill", 5, { grain: 1 }, { flour: 1 });
    const brewery = job("brewery", 1, { grain: 1 }, { beer: 1 });
    const buffered = [{ ...mill, inputTargets: { grain: 2 } },
      { ...brewery, inputTargets: { grain: 2 } }, grain];
    const result = run(10, buffered, { grain: 1 });
    expect(result.completedCycles.mill).toBe(2);
    expect(run(10, [mill, brewery, grain], { grain: 1 }).completedCycles.mill).toBe(1);
    expect(result).toEqual(run(10, buffered, { grain: 1 }));
    const retained = result.buffers.reduce((sum, buffer) => sum + (buffer.stock.grain ?? 0), 0);
    expect((result.islands[0]!.stock.grain ?? 0) + retained + (result.islands[0]!.consumed.grain ?? 0))
      .toBe(1 + (result.islands[0]!.produced.grain ?? 0));
  });
  it("shares scarce warehouse input between competing consumers", () => {
    const farm = job("farm", 10, {}, { grain: 1 });
    const consumers = ["a", "b", "c"].map(uid => ({ ...job(uid, 100, { grain: 1 }, { [uid]: 1 }),
      inputTargets: { grain: 1 } }));
    const result = run(200, [farm, ...consumers], { grain: 0 });
    expect(result.completedCycles).toMatchObject({ a: 1, b: 1, c: 1 });
    expect(result.islands[0]!.produced).toEqual({ a: 1, b: 1, c: 1, grain: 20 });
  });
  it("gives the shorter delivery lane more units of a scarce shared input", () => {
    const farm = job("farm", 10, {}, { grain: 1 });
    const fast = { ...job("fast", 100, { grain: 1 }, { fast: 1 }), inputTargets: { grain: 1 },
      inputDeliveryTicks: { grain: 10 } };
    const slow = { ...job("slow", 100, { grain: 1 }, { slow: 1 }), inputTargets: { grain: 1 },
      inputDeliveryTicks: { grain: 100 } };
    const result = run(1_000, [farm, fast, slow], { grain: 0 });
    expect(result.completedCycles.fast ?? 0).toBeGreaterThan(result.completedCycles.slow ?? 0);
  });
  it("sends scarce animal feed to the higher-value downstream chain", () => {
    const farm = job("farm", 200, {}, { pig: 1 });
    const meat = { ...job("meat", 50, { pig: 1 }, { meat: 1 }), inputTargets: { pig: 1 } };
    const hides = { ...job("hides", 50, { pig: 1 }, { hides: 1 }), inputTargets: { pig: 1 } };
    const tannery = { ...job("tannery", 100, { hides: 1 }, { leather: 1 }), inputTargets: { hides: 1 } };
    const leatherworks = { ...job("leatherworks", 100, { leather: 1 }, { armor: 1 }), inputTargets: { leather: 1 } };
    const result = run(1_000, [farm, meat, hides, tannery, leatherworks], { pig: 0 });
    expect(result.completedCycles.hides ?? 0).toBeGreaterThan(result.completedCycles.meat ?? 0);
  });
  it("owns partial deliveries but pays multi-input recipes atomically", () => {
    const recipe = { ...job("tools", 2, { iron: 1, planks: 1 }, { axe: 1 }), inputTargets: { iron: 2, planks: 2 } };
    const result = run(3, [recipe], { iron: 2 });
    expect(result.islands[0]!.consumed).toEqual({});
    expect(result.inProgress).toEqual([]);
    expect(result.buffers).toEqual([{ uid: "tools", islandId: "home", stock: { iron: 2 } }]);
    const supplied = run(4, [recipe, job("sawmill", 1, {}, { planks: 1 })], { iron: 2 });
    expect(supplied.completedCycles.tools).toBe(1);
    expect(supplied.islands[0]!.consumed).toEqual({ iron: 2, planks: 2 });
    expect(supplied.inProgress.find(work => work.uid === "tools")?.finishTick).toBe(5);
  });
  it("pools alternative foods and does not reserve synthetic inputs implicitly", () => {
    const mine = { ...job("mine", 2, { "~ore": 1 }, { iron: 1 }),
      alternativeFoods: ["fish", "meat"], inputTargets: { fish: 2, meat: 2 } };
    const result = run(1, [mine], { "~ore": 2, fish: 3, meat: 5 });
    expect(result.islands[0]!.consumed).toEqual({ "~ore": 1, fish: 1 });
    expect(result.buffers[0]!.stock).toEqual({ fish: 0 });
    expect(result.islands[0]!.stock.meat).toBe(5);
    expect(result.islands[0]!.stock["~ore"]).toBe(1);
  });
  it("skips allocation at zero horizon and stops refilling exhausted or expired work", () => {
    const recipe = { ...job("mill", 2, { grain: 1 }, { flour: 1 }), inputTargets: { grain: 2 } };
    expect(run(0, [recipe], { grain: 3 })).toMatchObject({
      events: 0, islands: [{ stock: { grain: 3 } }], buffers: [{ stock: {} }]
    });
    expect(run(10, [{ ...recipe, outputSequence: [] }], { grain: 3 }).buffers[0]!.stock).toEqual({});
    const ended = run(10, [{ ...recipe, outputSequence: [{ flour: 1 }] }], { grain: 3 });
    expect(ended.buffers[0]!.stock).toEqual({ grain: 1 });
    expect(ended.islands[0]!.stock.grain).toBe(1);
    expect(run(10, [{ ...recipe, endTick: 1 }], { grain: 3 }).islands[0]!.stock.grain).toBe(3);
    expect(run(3, [{ ...job("idle", 1), inputTargets: {} }]).buffers[0]!.stock).toEqual({});
  });
  it("checks recycled output space without subtracting buffered inputs twice", () => {
    const recycle = { ...job("recycle", 1, { logs: 1 }, { logs: 1 }), inputTargets: { logs: 1 } };
    const result = run(3, [recycle], { logs: 1 }, { logs: 1 });
    expect(result.completedCycles.recycle).toBe(3);
    expect(result.islands[0]!.stock.logs).toBe(1);
    expect(result.buffers[0]!.stock.logs).toBe(0);
  });
  it("preserves transfers and validates production-only recipe targets", () => {
    expect(shipping(3, [transfer("ship")]).buffers).toEqual([]);
    expect(() => shipping(3, [{ ...transfer("ship"), inputTargets: { logs: 1 } }]))
      .toThrow("cannot have input targets");
    expect(() => run(3, [{ ...job("bad", 1), inputTargets: { grain: 1 } }])).toThrow("recipe inputs");
    expect(() => run(3, [{ ...job("bad", 1, { grain: 1 }), inputTargets: { grain: -1 } }]))
      .toThrow("goods amount");
  });
});

describe("producer-owned output logistics", () => {
  const yard = (stock = {}, totalCapacity = 6) => ({ islandId: "yard", ownerIslandId: "home", stock, totalCapacity });
  const supplier = (accountId: string, routeCost = 1, deliveryTicks = 2) =>
    ({ accountId, routeCost, deliveryTicks, workTicks: 0 });
  it("uses a stocked producer before export and credits gross output only to its real island", () => {
    const producer = { ...job("mine", 1, {}, { iron: 1 }), outputAccountId: "yard", outputSequence: [{ iron: 1 }] };
    const consumer = { ...job("smith", 1, { iron: 1 }, { axe: 1 }), inputTargets: { iron: 1 },
      inputDeliveryTicks: { iron: 20 }, inputSuppliers: { iron: [supplier("yard")] } };
    const exportJob = { uid: "export", islandId: "yard", destinationIslandId: "home", kind: "transfer" as const,
      cycleTicks: 5, inputs: { iron: 1 }, outputs: { iron: 1 } };
    const result = runOfflineEconomyEvents({ horizonTicks: 4, jobs: [producer, consumer, exportJob],
      islands: [{ islandId: "home", stock: {} }, yard()] });
    expect(result.islands[0]!.produced).toEqual({ iron: 1, axe: 1 });
    expect(result.islands[1]!.produced).toEqual({});
    expect(result.islands[1]!.received).toEqual({ iron: 1 });
    expect(result.islands[1]!.sent).toEqual({ iron: 1 });
    expect(result.completedCycles.export).toBeUndefined();
    expect(result.islands[0]!.stock.iron ?? 0).toBe(0);
  });
  it("honors a shared mixed-output yard limit and keeps synthetic tokens outside it", () => {
    const producer: OfflineEconomyJob = { ...job("mixed", 1, {}, { axe: 0, saw: 0 }), outputAccountId: "yard",
      outputSequence: [{ axe: 1, "~stump": 1 }, { saw: 1 }, { axe: 1 }, { saw: 1 }] };
    const result = runOfflineEconomyEvents({ horizonTicks: 10, jobs: [producer],
      islands: [{ islandId: "home", stock: {} }, yard({}, 3)] });
    expect(result.completedCycles.mixed).toBe(3);
    expect(result.islands[1]!.stock).toEqual({ axe: 2, saw: 1 });
    expect(result.islands[0]!.stock["~stump"]).toBe(1);
    expect(result.islands[1]!.stock["~stump"]).toBeUndefined();
  });
  it("refunds unfinished direct pickup to its original yard without overflowing it", () => {
    const producer = { ...job("producer", 1, {}, { iron: 1 }), outputAccountId: "yard" };
    const consumer = { ...job("tools", 1, { iron: 1 }, { axe: 1 }), inputTargets: { iron: 1 },
      inputSuppliers: { iron: [supplier("yard", 1, 20)] } };
    const result = runOfflineEconomyEvents({ horizonTicks: 4, jobs: [producer, consumer],
      islands: [{ islandId: "home", stock: {} }, yard({ iron: 1 }, 1)] });
    expect(result.islands[1]!.stock.iron).toBe(1);
    expect(result.islands[1]!.sent.iron).toBe(0);
    expect(result.islands[0]!.consumed).toEqual({});
    expect(result.islands[0]!.produced).toEqual({});
    expect(result.buffers[0]!.directStock).toBeUndefined();
  });
  it("charges exports against the real shared fleet instead of creating a fleet per yard", () => {
    const exportJob = { uid: "export", islandId: "yard", destinationIslandId: "home", kind: "transfer" as const,
      workOwnerIslandId: "home", cycleTicks: 1, workTicks: 10, workOverlapsCycle: true,
      inputs: { iron: 1 }, outputs: { iron: 1 } };
    const result = runOfflineEconomyEvents({ horizonTicks: 10, jobs: [exportJob],
      islands: [{ islandId: "home", stock: {}, workCapacity: 1 }, yard({ iron: 2 })] });
    expect(result.completedCycles.export).toBe(1);
    expect(result.islands[0]!.received).toEqual({ iron: 1 });
    expect(result.islands[1]!.stock.iron).toBe(1);
  });
  it("selects a newly mature nearby source before a farther original identity", () => {
    const cutter: OfflineEconomyJob = { ...job("cutter", 1, { "~trees": 1 }, { logs: 1 }),
      firstTick: 1, endTick: 2, sourceChoices: { input: "~trees", choices: [
        { token: "~far", priority: 20 }, { token: "~new", priority: 2, outputs: { "~stump": 1 } }
      ] } };
    const growth = { ...job("grow", 1, {}, {}), outputSequence: [{ "~trees": 1, "~new": 1 }] };
    const result = run(2, [cutter, growth], { "~trees": 1, "~far": 1 });
    expect(result.islands[0]!.consumed).toEqual({ "~trees": 1, "~new": 1 });
    expect(result.islands[0]!.stock["~far"]).toBe(1);
    expect(result.islands[0]!.produced.logs).toBe(1);
    expect(result.islands[0]!.stock["~stump"]).toBe(1);
  });
});


it("keeps unused warehouse-backed buffers inside warehouse capacity on refund", () => {
  const bakery = { ...job("bakery", 1, { water: 1, flour: 1 }, { bread: 1 }),
    inputTargets: { water: 1, flour: 1 } };
  const result = run(10, [bakery, job("well", 1, {}, { water: 1 })], { water: 1 }, { water: 1 });
  expect(result.islands[0]!.produced).toEqual({});
  expect(result.islands[0]!.consumed).toEqual({});
  expect(result.buffers[0]!.stock).toEqual({ water: 1 });
  expect((result.islands[0]!.stock.water ?? 0) + (result.buffers[0]!.stock.water ?? 0)).toBe(1);
});
