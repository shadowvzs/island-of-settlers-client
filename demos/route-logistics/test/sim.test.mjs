import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  addBuilding, addCarrier, checkConservation, createSimulation, exportState, flagTotals,
  rebuildRoutes, removeBuilding, routeSummary, stateHash, step, stepMany, summary, totals
} from "../src/sim.js";

const island = JSON.parse(await readFile(new URL("../data/island.json", import.meta.url), "utf8"));
const make = (overrides = {}) => createSimulation(island, overrides);
const run = (state, seconds, dt = 0.1) => stepMany(state, seconds, dt);

test("routes cover every building exactly once, with the headquarters as the endpoint", () => {
  const state = make();
  const stops = state.routes.flatMap(route => route.stops.slice(1, -1));
  assert.equal(new Set(stops).size, stops.length, "a building is on more than one route");
  const expected = [...state.buildings.keys()].filter(uid => uid !== state.hubUid).sort((a, b) => a - b);
  assert.deepEqual([...stops].sort((a, b) => a - b), expected);
  for (const route of state.routes) {
    assert.equal(route.stops[0], state.hubUid);
    assert.equal(route.stops.at(-1), state.hubUid);
    assert.ok(route.legs.length >= 2);
  }
});

test("capped buffers and cart capacity hold over ten simulated minutes", () => {
  const state = make();
  run(state, 600);
  for (const flag of state.flags.values()) {
    const total = [...flag.stock.values()].reduce((sum, value) => sum + value, 0);
    assert.ok(total <= flag.totalCapacity, `flag ${flag.uid} over total capacity: ${total}/${flag.totalCapacity}`);
    for (const [ware, amount] of flag.stock)
      assert.ok(amount <= flag.wareCapacity, `flag ${flag.uid} ${ware} over ware capacity: ${amount}/${flag.wareCapacity}`);
    assert.ok(total >= 0);
  }
  for (const carrier of state.carriers) {
    assert.ok(carrier.cargo.length <= state.options.cartCapacity,
      `carrier ${carrier.id} over cart capacity: ${carrier.cargo.length}`);
    assert.ok(carrier.cargo.length >= 0);
  }
});

test("ware conservation holds while workers and carriers move goods", () => {
  const state = make();
  run(state, 600);
  const result = checkConservation(state);
  assert.equal(result.ok, true, JSON.stringify(result.problems.slice(0, 4), null, 2));
});

test("deterministic replay gives the same state hash", () => {
  const first = make(), second = make();
  run(first, 300);
  run(second, 300);
  assert.equal(stateHash(first), stateHash(second));
});

test("production and delivery actually happen", () => {
  const state = make();
  run(state, 900);
  const report = summary(state);
  assert.ok(report.produced > 0, "nothing was produced");
  assert.ok(report.delivered > 0, "nothing was delivered");
  assert.ok(report.cartUtilization >= 0 && report.cartUtilization <= 1);
  const stock = totals(state).flagStock;
  assert.ok([...stock.values()].some(value => value > 0));
});

test("flags sit in a shared bay outside every plot, not on the signpost", () => {
  const state = make();
  const margin = 0.36 + 0.06;
  for (const building of state.buildings.values()) {
    const flag = state.flags.get(building.uid);
    const bayDistance = Math.hypot(flag.x - building.access.x, flag.z - building.access.z);
    assert.ok(bayDistance > 0.1, `flag ${building.uid} is still on the signpost`);
    for (const other of state.buildings.values()) {
      const inside = Math.abs(flag.x - other.x) <= other.width / 2 + margin &&
        Math.abs(flag.z - other.z) <= other.depth / 2 + margin;
      assert.ok(!inside, `flag ${building.uid} bay is inside building ${other.uid}`);
    }
  }
});

test("event-driven carriers conserve ware and stay deterministic", () => {
  const state = make({ eventCarriers: true });
  run(state, 600);
  assert.equal(checkConservation(state).ok, true);
  assert.ok(summary(state).delivered > 0, "event-driven carriers delivered nothing");
  assert.ok(Array.isArray(state.eventQueue));
  const other = make({ eventCarriers: true });
  run(other, 600);
  assert.equal(stateHash(state), stateHash(other));
});

test("smart skip is deterministic, conserves ware, and skips stops", () => {
  const state = make({ smartSkip: true });
  run(state, 600);
  assert.equal(checkConservation(state).ok, true);
  assert.ok(summary(state).skippedStops > 0, "smart skip did not skip any stop");
  const other = make({ smartSkip: true });
  run(other, 600);
  assert.equal(stateHash(state), stateHash(other));
});

test("goods load and unload one unit at a time", () => {
  const state = make();
  const previous = new Map(state.carriers.map(carrier => [carrier.id, 0]));
  let changes = 0;
  for (let index = 0; index < 6000; index++) {
    step(state, 0.1);
    for (const carrier of state.carriers) {
      const count = carrier.cargo.length;
      const before = previous.get(carrier.id);
      if (count !== before) {
        assert.ok(Math.abs(count - before) <= 1, `carrier ${carrier.id} moved ${count - before} units at once`);
        changes++;
        previous.set(carrier.id, count);
      }
    }
  }
  assert.ok(changes > 0, "no cargo moved");
});

test("the buffer cap creates backpressure instead of overfilling", () => {
  const state = make({ flagTotalCapacity: 2, flagWareCapacity: 1 });
  run(state, 300);
  for (const flag of state.flags.values()) {
    if (flag.uid === state.hubUid) continue;
    assert.ok([...flag.stock.values()].reduce((sum, value) => sum + value, 0) <= 2);
    for (const amount of flag.stock.values()) assert.ok(amount <= 1);
  }
});

test("a building can be added at runtime, routed, and removed again", () => {
  const state = make();
  const farm = island.catalog.find(entry => entry.name === "Farm");
  const before = state.buildings.size;
  const added = addBuilding(state, { typeId: farm.typeId, x: 84, z: 58 });
  assert.equal(state.buildings.size, before + 1);
  assert.ok(state.flags.has(added.uid));
  assert.ok([...state.routes].some(route => route.stops.includes(added.uid)), "new building is not on a route");
  run(state, 120);
  assert.equal(checkConservation(state).ok, true);
  removeBuilding(state, added.uid);
  assert.equal(state.buildings.size, before);
  assert.ok(!state.flags.has(added.uid));
});

test("an extra carrier joins a route and keeps the invariants", () => {
  const state = make();
  const route = state.routes[0];
  const before = state.carriers.length;
  addCarrier(state, route.id);
  assert.equal(state.carriers.length, before + 1);
  run(state, 180);
  assert.equal(checkConservation(state).ok, true);
  assert.ok(state.carriers.filter(carrier => carrier.routeId === route.id).length >= 2);
});

test("stale event generations are ignored", () => {
  const state = make({ eventCarriers: true });
  const carrier = state.carriers[0];
  const stale = {
    at: state.time,
    seq: state.eventSeq++,
    kind: "arrive",
    carrierId: carrier.id,
    generation: (carrier.taskGeneration ?? 0) + 1
  };
  state.eventQueue.push(stale);
  state.eventQueue.sort((first, second) => first.at - second.at || first.seq - second.seq);
  const before = state.stats.services;
  step(state, 0.01);
  assert.equal(state.stats.services, before);
});

test("event carrier start delay waits at the hub, then travels without jumping", () => {
  const state = make({ eventCarriers: true });
  const route = state.routes[0];
  const carrier = addCarrier(state, route.id);
  assert.ok(carrier.startDelay > 0);
  assert.equal(carrier.state, "waiting");
  assert.equal(carrier.distance, 0);
  assert.ok(state.eventQueue.some(event => event.kind === "start" &&
    event.carrierId === carrier.id && event.generation === carrier.taskGeneration));

  step(state, carrier.legStartedAt - 0.01);
  assert.equal(carrier.state, "waiting");
  assert.equal(carrier.distance, 0);

  step(state, 0.02);
  assert.equal(carrier.state, "travel");
  assert.ok(carrier.distance > 0);
  assert.ok(carrier.distance < carrier.pathLength);
});

test("export state carries event generation, delay, queues and scheduler ids", () => {
  const state = make({ eventCarriers: true });
  const route = state.routes[0];
  const carrier = addCarrier(state, route.id);
  const exported = exportState(state);
  assert.equal(exported.eventSeq, state.eventSeq);
  assert.equal(exported.nextCarrierId, state.nextCarrierId);
  assert.ok(exported.docks && Array.isArray(exported.docks.active) && Array.isArray(exported.docks.queue));
  const savedCarrier = exported.carriers.find(entry => entry.id === carrier.id);
  assert.equal(savedCarrier.startDelay, carrier.startDelay);
  assert.equal(savedCarrier.taskGeneration, carrier.taskGeneration);
  assert.ok(exported.eventQueue.every(event => "generation" in event && "seq" in event));
  assert.ok(exported.flags.every(flag => "bay" in flag && Array.isArray(flag.queue)));
});

test("export state is JSON serializable and contains the route summary", () => {
  const state = make();
  run(state, 60);
  const exported = exportState(state);
  const text = JSON.stringify(exported);
  assert.ok(text.length > 100);
  assert.equal(exported.routes.length, state.routes.length);
  assert.equal(exported.flags.length, state.flags.size);
  assert.ok(exported.summary.time >= 60);
  assert.ok(routeSummary(state).every(route => route.stops.length >= 2));
  assert.ok(flagTotals(state).every(flag => flag.total <= flag.capacity));
  assert.ok(exported.carriers.every(carrier => "servicePhase" in carrier && "serviceTimer" in carrier &&
    "transferAnim" in carrier && "skipNext" in carrier), "in-flight transfer state is not exported");
});

test("rebuilding routes keeps every building connected", () => {
  const state = make();
  rebuildRoutes(state);
  const stops = state.routes.flatMap(route => route.stops.slice(1, -1));
  assert.equal(new Set(stops).size, [...state.buildings.keys()].length - 1);
  run(state, 60);
  assert.equal(checkConservation(state).ok, true);
});
