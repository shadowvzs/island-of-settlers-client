import { afterEach, expect, it, vi } from "vitest";

import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { isHomeBuilding } from "../src/shared/settlement/settlement-home";
import { setLandReusePassMemo } from "../src/shared/settlement/settlement-land-reuse-memo";
import type { LandReuseJob } from "../src/shared/settlement/settlement-land-reuse-scheduler";
import {
  createWalkingCarrierPool, setLazyReturningRoutes, walkingCarrierCandidates
} from "../src/shared/settlement/settlement-land-transport-selection";
import { nearestStorage } from "../src/shared/settlement/settlement-logistics";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementActor, SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { noteSettlerDemand } from "../src/shared/settlement/settler-relocation";
import { chooseTransportForJob, type TransportReuseCandidate } from "../src/shared/settlement/transport-reuse-policy";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { readDevelopedFixture } from "./helpers/developed-fixture";

/** The real context and job collector the simulation hands its reuse scheduler. */
const reuse = vi.hoisted(() => ({
  collect: undefined as ((source?: number) => LandReuseJob[]) | undefined,
  context: undefined as SettlementContext | undefined
}));

vi.mock("../src/shared/settlement/settlement-land-reuse-scheduler", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/shared/settlement/settlement-land-reuse-scheduler")>();
  return {
    ...actual,
    createLandReuseScheduler: (...args: Parameters<typeof actual.createLandReuseScheduler>) => {
      [reuse.context, reuse.collect] = args;
      return actual.createLandReuseScheduler(...args);
    }
  };
});

vi.mock("../src/shared/settlement/settler-relocation", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/shared/settlement/settler-relocation")>();
  return { ...actual, noteSettlerDemand: vi.fn(actual.noteSettlerDemand) };
});

const SIZE = 64;
const flatWorld = () => ({
  seed: 77, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 8.5, z: 8.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

afterEach(() => {
  setLandReusePassMemo(true);
  setLazyReturningRoutes(true);
  vi.mocked(noteSettlerDemand).mockClear();
});

it("collects reuse jobs without writing state or noting settler demand", () => {
  const world = flatWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ initialSettlers: 10, roads, world });
  expect(simulation.debugRaiseBuilding(29).ok).toBe(true);
  expect(simulation.debugRaiseBuilding(WOODCUTTER_TYPE_ID).ok).toBe(true);
  const context = reuse.context!;
  const store = context.buildings.find(building => building.typeId === 29)!;
  const woodcutter = context.buildings.find(building => building.typeId === WOODCUTTER_TYPE_ID)!;
  // Finished logs waiting at the hut: collect lists their haul, a dispatch would send a carrier.
  woodcutter.output = { logs: 2 };
  const before = JSON.stringify(simulation.saveState()), demand = [...context.population!.demand];

  const jobs = reuse.collect!();

  expect(jobs.some(job => job.source === woodcutter && job.ware === "logs")).toBe(true);
  expect(noteSettlerDemand).not.toHaveBeenCalled();
  expect([...context.population!.demand]).toEqual(demand);
  expect(JSON.stringify(simulation.saveState())).toBe(before);
  // The spy is live: the dispatch-time lookup from the unstaffed store does note it.
  nearestStorage(context, store, undefined, undefined, true);
  expect(noteSettlerDemand).toHaveBeenCalledWith(context, store);
});

it("keeps the developed fixture bit-identical with the reuse pass memo switched off", async () => {
  const source = await readDevelopedFixture();
  const play = async (memo: boolean) => {
    setLandReusePassMemo(memo);
    const island = await createHeadlessIsland(structuredClone(source));
    for (let tick = 0; tick < 600; tick++) island.simulation.update(0.05);
    return hashSettlementState({ runtime: island.runtimeState(), settlement: island.simulation.saveState(),
      world: island.world });
  };
  expect(await play(true)).toBe(await play(false));
}, 120_000);

/** Like the bench's `scaled` fixture: extra carriers walking home from the first road nodes. */
const withReturningCarriers = (save: GameSaveV1, count: number) => {
  const settlement = save.settlement as unknown as { actors: unknown[]; integrity: { actors: number };
    nextActor: number; roads: { end: SettlementPoint; start: SettlementPoint }[] };
  const nodes = [...new Map(settlement.roads.flatMap(segment => [segment.start, segment.end])
    .map(point => [`${point.x},${point.z}`, point])).values()];
  const home = (save.settlement.buildings.find(isHomeBuilding) ?? save.settlement.buildings[0])!.uid;
  for (let index = 0; index < count; index++) {
    const { x, z } = nodes[(index * 7) % nodes.length]!;
    settlement.actors.push({ action: "idle", animationTime: 0, building: home, home, job: "Carrier", path: [],
      pathIndex: 0, phase: "home", queueWait: 0, timer: 0, uid: settlement.nextActor++, visible: true, ware: null,
      x, y: 2, yaw: 0, z });
  }
  settlement.integrity.actors = settlement.actors.length;
  return save;
};

/** The pool against the eager list for one source: same unit, same pickup route, same tie-breaks. */
const expectPoolMatchesEager = (context: SettlementContext, source: SettlementContext["buildings"][number],
  allowClaim: boolean) => {
  const eager = walkingCarrierCandidates(context, source, allowClaim);
  const pool = createWalkingCarrierPool(context, source, allowClaim);
  const best = chooseTransportForJob(eager.map(candidate => ({ ...candidate, value: candidate })));
  expect(pool.choose(pickup => pickup)?.actor).toBe(best?.value.actor);
  if (best) expect(pool.pickup(best.value.actor)?.points).toEqual(best.value.points);
  for (const candidate of eager) expect(pool.mayHold(candidate.value.actor)).toBe(true);
  for (const actor of context.actors)
    expect(pool.pickup(actor) !== undefined).toBe(eager.some(candidate => candidate.value.actor === actor));
  if (!best) return 0;
  // A rival with the winner's rank and cost: the lower id wins unless the winner is a returning carrier.
  const rival: TransportReuseCandidate<SettlementActor | null> = { atSource: best.atSource,
    availability: best.availability === "returning" ? "idle" : best.availability, id: best.id - 1,
    routeCost: best.routeCost, value: null };
  const expected = chooseTransportForJob([...eager.map(candidate => ({ ...candidate, value: candidate.value.actor })),
    rival]);
  expect(createWalkingCarrierPool(context, source, allowClaim).choose(pickup => pickup.actor, [rival]))
    .toBe(expected);
  return eager.filter(candidate => candidate.availability === "returning").length;
};

it("chooses exactly the eager walking candidates while returning routes are deferred (A04d)", async () => {
  const island = await createHeadlessIsland(withReturningCarriers(await readDevelopedFixture(), 80));
  const context = reuse.context!;
  let returning = 0;
  for (let tick = 0; tick < 300; tick++) {
    island.simulation.update(0.05);
    if (tick % 60 !== 59) continue;
    for (const source of context.buildings)
      for (const allowClaim of [true, false]) returning += expectPoolMatchesEager(context, source, allowClaim);
  }
  expect(returning).toBeGreaterThan(500);
}, 120_000);

it("keeps a crowded developed fixture bit-identical with deferred returning routes switched off", async () => {
  const source = withReturningCarriers(await readDevelopedFixture(), 80);
  const play = async (lazy: boolean) => {
    setLazyReturningRoutes(lazy);
    const island = await createHeadlessIsland(structuredClone(source));
    for (let tick = 0; tick < 600; tick++) island.simulation.update(0.05);
    return hashSettlementState({ runtime: island.runtimeState(), settlement: island.simulation.saveState(),
      world: island.world });
  };
  expect(await play(true)).toBe(await play(false));
}, 240_000);
