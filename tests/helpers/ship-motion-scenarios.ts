import { performance } from "node:perf_hooks";

import {
  SAILING_SHIP_HULL_BEAM, SAILING_SHIP_HULL_LENGTH
} from "../../src/render-common/ships/ship-dimensions";
import type { ShipFrame } from "../../src/render-common/ships/ship-frame";
import { SHIP_SAILING_MULTIPLIER } from "../../src/shared/balance/colonies";
import { createNavalFleet } from "../../src/shared/settlement/settlement-naval-fleet";
import { makeBuilding } from "../../src/shared/settlement/settlement-placement";
import { createSeaMask } from "../../src/shared/settlement/settlement-sea-navigation";
import {
  createShipClearanceMasks, shipHullFitsSea, shipsOverlap
} from "../../src/shared/settlement/settlement-ship-clearance";
import type { SettlementContext, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

/**
 * One shared ship-motion harness: deterministic sea worlds, the fleet's own tick, and one metric
 * vocabulary (slip, turn rate, overlaps, shore contact, blocked time, path ratio, CPU) that every
 * ship-motion change is judged by (docs/archive/dated/ship-motion-2026-10-13.md).
 */
export const SHIP_TICK = .05;
const MOVING = new Set<ShipFrame["phase"]>(["positioning", "sailing"]);
const STEP_EPSILON = 1e-4;

export interface ShipSea {
  context: SettlementContext;
  /** A finished harbour at (x, z), turned by `rotation` quarter turns. */
  harbour(z: number, x?: number, rotation?: number, level?: 0 | 1 | 2 | 3 | 4): SettlementContext["buildings"][number];
  sea: Uint8Array;
  world: WorldData;
}

/** A headland reaching out from the coast between rows z0 and z1 to column `tip`. */
export interface ShipSeaSpur { z0: number; z1: number; tip: number }
/** A west coast (land x < 20) with open sea east of it; `spurs` add headlands the ships sail round. */
export const createShipSea = (cellsZ = 120, spurs: ShipSeaSpur | readonly ShipSeaSpur[] = []): ShipSea => {
  const headlands = Array.isArray(spurs) ? spurs : [spurs as ShipSeaSpur];
  return createShipSeaWorld(90, cellsZ, (x, z) =>
    x < 20 || headlands.some(spur => z >= spur.z0 && z <= spur.z1 && x < spur.tip));
};

/**
 * A sea world of `cellsX` × `cellsZ` cells: land where `land(x, z)` holds (sampled at vertices and cell
 * centres).
 */
export const createShipSeaWorld = (
  cellsX: number, cellsZ: number, land: (x: number, z: number) => boolean
): ShipSea => {
  const heights = new Float32Array((cellsX + 1) * (cellsZ + 1));
  for (let z = 0; z <= cellsZ; z++) for (let x = 0; x <= cellsX; x++)
    heights[z * (cellsX + 1) + x] = land(x, z) ? 0 : -2;
  const world = { blocking: new Uint8Array(cellsX * cellsZ),
    buildClass: new Uint8Array(cellsX * cellsZ).fill(BUILD.large), cellsX, cellsZ, heights,
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() },
    seaLevel: -1, walkCost: new Uint8Array(cellsX * cellsZ).fill(10) } as unknown as WorldData;
  for (let z = 0; z < cellsZ; z++) for (let x = 0; x < cellsX; x++)
    if (!land(x + .5, z + .5)) world.walkCost[z * cellsX + x] = 0;
  const route = (_from: SettlementPoint, to: SettlementPoint) => ({ cost: 1, length: 1, points: [{ ...to }] });
  const context = { accumulator: 0, actors: [], buildings: [], nextActor: 1, nextBuilding: 1,
    occupied: new Uint8Array(cellsX * cellsZ),
    options: { findWorkerPath: (_from: SettlementPoint, to: SettlementPoint) => [{ ...to }], roads: { route }, world },
    reservations: new Set(), resourceAmounts: new Map(), scheduling: 0, settlers: 20, transfers: []
  } as unknown as SettlementContext;
  /** A finished harbour; `level` (saved, 2 = building level 3) unlocks its second berth. */
  const harbour = (z: number, x = 15, rotation = 0, level?: 0 | 1 | 2 | 3 | 4) => {
    const building = makeBuilding(context, 39, x, z, rotation);
    if (level !== undefined) building.workshopUpgrade = { level };
    building.construction = 1; context.buildings.push(building); return building;
  };
  return { context, harbour, sea: createSeaMask(world), world };
};

/** What the harness drives: the fleet itself, or a whole simulation's ship frames and tick. */
interface ShipMotionSource { frames(): ShipFrame[]; update(dt: number): void }
export interface ShipScenario {
  done(): boolean; fleet: ShipMotionSource; seconds: number; sea: Pick<ShipSea, "sea" | "world">;
}


export interface ShipMotionMetrics {
  blockedSeconds: number;
  completed: boolean;
  cpuMaxMs: number;
  cpuMeanMs: number;
  /** Ticks where two envelopes including the spacing gap intersect (a near miss). */
  envelopeTicks: number;
  /** Ticks where two hulls (without the spacing gap) intersect. */
  hullContactTicks: number;
  inPlaceTurnSeconds: number;
  /** Largest change of speed along the keel (tiles/s²): instant starts and stops show here. */
  maxAcceleration: number;
  maxSlipDeg: number;
  maxTurnRate: number;
  /** Tightest radius the hull centre turned on while sailing faster than a crawl (tiles). */
  minTurnRadius: number;
  pathRatio: number;
  seconds: number;
  shoreTicks: number;
  slipRatio: number;
  strandedSeconds: number;
  travelled: number;
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Below this speed (tiles/s) a turn counts as manoeuvring, not as a sailed curve. */
const CRAWL_SPEED = .3 * SHIP_SAILING_MULTIPLIER;
/** A frame-to-frame move longer than this is a re-entry at the map edge, not sailing. */
const TELEPORT = 1;

/** Hull rectangles (no spacing gap) intersect: a real collision, not only a near miss. */
const hullsTouch = (a: ShipFrame, b: ShipFrame) => {
  const halfLength = SAILING_SHIP_HULL_LENGTH / 2, halfBeam = SAILING_SHIP_HULL_BEAM / 2;
  const extent = (yaw: number, axis: number) =>
    Math.abs(Math.cos(yaw - axis)) * halfLength + Math.abs(Math.sin(yaw - axis)) * halfBeam;
  return [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2].every(axis =>
    Math.abs((b.x - a.x) * Math.sin(axis) + (b.z - a.z) * Math.cos(axis)) < extent(a.yaw, axis) + extent(b.yaw, axis));
};

/** Octile shortest distance over turning-clear water: the yardstick for path length. */
const seaGeodesic = (world: WorldData, turning: Uint8Array, from: SettlementPoint, to: SettlementPoint) => {
  const cells = world.cellsX * world.cellsZ, distance = new Float64Array(cells).fill(Infinity);
  const start = Math.floor(from.z) * world.cellsX + Math.floor(from.x);
  const goal = Math.floor(to.z) * world.cellsX + Math.floor(to.x);
  distance[start] = 0;
  const open = [start];
  while (open.length) {
    let best = 0;
    for (let index = 1; index < open.length; index++) if (distance[open[index]!]! < distance[open[best]!]!) best = index;
    const cell = open.splice(best, 1)[0]!;
    if (cell === goal) return distance[goal]!;
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
      if ((!dx && !dz) || nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
      if (!turning[next] && next !== goal) continue;
      const total = distance[cell]! + Math.hypot(dx, dz);
      if (total >= distance[next]!) continue;
      if (distance[next] === Infinity) open.push(next);
      distance[next] = total;
    }
  }
  return Math.hypot(to.x - from.x, to.z - from.z);
};

interface ShipTrack { frame: ShipFrame; speed?: number; voyage?: { from: SettlementPoint; travelled: number } }

const emptyMetrics = (): ShipMotionMetrics => ({ blockedSeconds: 0, completed: false, cpuMaxMs: 0, cpuMeanMs: 0,
  envelopeTicks: 0, hullContactTicks: 0, inPlaceTurnSeconds: 0, maxAcceleration: 0, maxSlipDeg: 0, maxTurnRate: 0,
  minTurnRadius: Infinity, pathRatio: 1, seconds: 0, shoreTicks: 0, slipRatio: 0, strandedSeconds: 0, travelled: 0 });

/** Per-tick, per-ship motion bookkeeping shared by every scenario. */
const createShipMotionRecorder = (sea: ShipScenario["sea"]) => {
  const metrics = emptyMetrics(), tracks = new Map<number, ShipTrack>();
  const turning = createShipClearanceMasks(sea.world, sea.sea).turning;
  let slip = 0, ideal = 0, sailed = 0;
  const closeVoyage = (track: ShipTrack, frame: ShipFrame) => {
    const voyage = track.voyage;
    track.voyage = undefined;
    if (!voyage || voyage.travelled < 2) return;
    sailed += voyage.travelled; ideal += seaGeodesic(sea.world, turning, voyage.from, frame);
  };
  const recordStill = (frame: ShipFrame, turn: number) => {
    if (!MOVING.has(frame.phase)) return;
    if (turn > 1e-6) metrics.inPlaceTurnSeconds += SHIP_TICK;
    else metrics.blockedSeconds += SHIP_TICK;
  };
  const recordStep = (track: ShipTrack, frame: ShipFrame, step: number, turn: number) => {
    const before = track.frame;
    const course = Math.abs(wrap(Math.atan2(frame.x - before.x, frame.z - before.z) - (frame.yaw + before.yaw) / 2));
    const offset = Math.min(course, Math.PI - course);
    // A swing round a point of the keel (oars, spring line) moves the centre across the keel
    // without any part of the hull sliding: only motion beyond that counts as a slide.
    const slide = Math.max(0, step * Math.sin(offset) - turn * SAILING_SHIP_HULL_LENGTH / 2);
    metrics.maxSlipDeg = Math.max(metrics.maxSlipDeg, Math.atan2(slide, step * Math.cos(offset)) * 180 / Math.PI);
    slip += slide; metrics.travelled += step;
    if (track.voyage) track.voyage.travelled += step;
    if (step / SHIP_TICK > CRAWL_SPEED && turn > 1e-4) metrics.minTurnRadius = Math.min(metrics.minTurnRadius, step / turn);
  };
  const recordShip = (frame: ShipFrame) => {
    if (frame.phase === "stranded") metrics.strandedSeconds += SHIP_TICK;
    const track = tracks.get(frame.id);
    const step = track ? Math.hypot(frame.x - track.frame.x, frame.z - track.frame.z) : 0;
    // A ship back from beyond the map edge re-enters elsewhere: a new track, not a jump.
    if (!track || step > TELEPORT) { tracks.set(frame.id, { frame }); return; }
    const before = track.frame;
    const turn = Math.abs(wrap(frame.yaw - before.yaw)), speed = step / SHIP_TICK;
    metrics.maxTurnRate = Math.max(metrics.maxTurnRate, turn / SHIP_TICK);
    if (track.speed !== undefined) metrics.maxAcceleration = Math.max(metrics.maxAcceleration,
      Math.abs(speed - track.speed) / SHIP_TICK);
    if (MOVING.has(frame.phase)) track.voyage ??= { from: before, travelled: 0 };
    else closeVoyage(track, frame);
    if (MOVING.has(frame.phase) && !shipHullFitsSea(sea.world, sea.sea, frame)) metrics.shoreTicks++;
    if (step < STEP_EPSILON) recordStill(frame, turn);
    else recordStep(track, frame, step, turn);
    track.frame = frame; track.speed = speed;
  };
  const recordPairs = (frames: readonly ShipFrame[]) => {
    let envelope = false, contact = false;
    for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
      envelope ||= shipsOverlap(frames[a]!, frames[b]!);
      contact ||= hullsTouch(frames[a]!, frames[b]!);
    }
    metrics.envelopeTicks += Number(envelope); metrics.hullContactTicks += Number(contact);
  };
  const finish = () => {
    metrics.slipRatio = metrics.travelled ? slip / metrics.travelled : 0;
    metrics.pathRatio = ideal ? sailed / ideal : 1;
    if (metrics.minTurnRadius === Infinity) metrics.minTurnRadius = 0;
    return metrics;
  };
  return { finish, metrics, recordPairs, recordShip };
};

/** Runs a scenario at the simulation's fixed tick and measures every ship every tick. */
export const measureShipScenario = ({ done, fleet, sea, seconds }: ShipScenario): ShipMotionMetrics => {
  const recorder = createShipMotionRecorder(sea), { metrics } = recorder;
  fleet.frames().forEach(recorder.recordShip);
  let cpu = 0, ticks = 0;
  for (; ticks < seconds / SHIP_TICK && !done(); ticks++) {
    const started = performance.now();
    fleet.update(SHIP_TICK);
    const spent = performance.now() - started;
    cpu += spent; metrics.cpuMaxMs = Math.max(metrics.cpuMaxMs, spent);
    const frames = fleet.frames();
    frames.forEach(recorder.recordShip);
    recorder.recordPairs(frames);
  }
  metrics.completed = done();
  metrics.seconds = ticks * SHIP_TICK;
  metrics.cpuMeanMs = cpu / Math.max(1, ticks);
  return recorder.finish();
};

const delivered = (building: SettlementContext["buildings"][number], ware: string, amount: number) =>
  () => (building.inventory[ware] ?? 0) >= amount;

/** `count` paid voyages from one harbour to another; the ships start scattered at sea. */
const transports = (starts: ReadonlyArray<{ x: number; yaw: number; z: number }>, sea = createShipSea(),
  harbours: [number, number] = [30, 90], seconds = 900): ShipScenario => {
  const source = sea.harbour(harbours[0]), destination = sea.harbour(harbours[1]);
  source.inventory = { planks: 10 * starts.length };
  const fleet = createNavalFleet(sea.context, sea.sea);
  for (const { yaw, ...point } of starts) fleet.addShip(point, yaw);
  for (const _ of starts) fleet.queueTransport(source.uid, destination.uid, { planks: 10 });
  return { done: delivered(destination, "planks", 10 * starts.length), fleet, seconds, sea };
};

/** Two ships bound in opposite directions along the same coast meet head on. */
export const headOnScenario = (): ShipScenario => {
  const sea = createShipSea(), north = sea.harbour(25), south = sea.harbour(95);
  north.inventory = { planks: 10 }; south.inventory = { stone: 10 };
  const fleet = createNavalFleet(sea.context, sea.sea);
  fleet.addShip({ x: 32.5, z: 22.5 }, Math.PI); fleet.addShip({ x: 32.5, z: 97.5 }, 0);
  fleet.queueTransport(north.uid, south.uid, { planks: 10 });
  fleet.queueTransport(south.uid, north.uid, { stone: 10 });
  const done = () => (south.inventory.planks ?? 0) >= 10 && (north.inventory.stone ?? 0) >= 10;
  return { done, fleet, seconds: 600, sea };
};

/** Four ships all load at one harbour and sail to another: berth queueing and anchorage. */
export const busyHarbourScenario = () => transports([
  { x: 40.5, yaw: 0, z: 10.5 }, { x: 60.5, yaw: 1, z: 30.5 }, { x: 45.5, yaw: 2, z: 55.5 }, { x: 70.5, yaw: 3, z: 70.5 }
]);

/** Four visiting ships come in from the map edge to one harbour at once. */
export const fourVisitorsScenario = (): ShipScenario => {
  const sea = createShipSea(), harbour = sea.harbour(60);
  const fleet = createNavalFleet(sea.context, sea.sea);
  for (let index = 0; index < 4; index++) fleet.sendVisitor(harbour.uid, { fish: 5 });
  return { done: () => (harbour.inventory.fish ?? 0) >= 20 && !fleet.frames().length, fleet, seconds: 900, sea };
};

/** A headland between the harbours: the route must bend round its tip. */
export const headlandScenario = () =>
  transports([{ x: 30.5, yaw: Math.PI, z: 20.5 }], createShipSea(120, { tip: 55, z0: 55, z1: 62 }));

/** A hull lying flush along the shore must get clear before it can turn. */
export const flushBerthScenario = () => transports([{ x: 22.5, yaw: 0, z: 40.5 }]);

/** Deterministic pseudo-random numbers (mulberry32). */
const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
/** Stress layouts start their ships a hull length and more apart. */
const STRESS_START_SPACING = 14;

/**
 * Stress layout `index`: a harbour pair placed from a fixed seed and `ships` ships scattered at sea,
 * each carrying one load from one harbour to the other (tools/bench/ship-stress.ts runs 16 of them).
 */
export const stressLayoutScenario = (index: number, ships = 6): ShipScenario => {
  const next = seededRandom(index + 1), sea = createShipSea();
  const harbours = [20 + Math.floor(next() * 30), 70 + Math.floor(next() * 30)];
  const [source, destination] = (index % 2 ? harbours.reverse() : harbours).map(z => sea.harbour(z));
  source!.inventory = { planks: 10 * ships };
  const fleet = createNavalFleet(sea.context, sea.sea), starts: SettlementPoint[] = [];
  while (starts.length < ships) {
    const start = { x: 34.5 + Math.floor(next() * 50), z: 8.5 + Math.floor(next() * 104) }, yaw = next() * Math.PI * 2;
    if (starts.some(other => Math.hypot(other.x - start.x, other.z - start.z) < STRESS_START_SPACING)) continue;
    starts.push(start);
    fleet.addShip(start, yaw);
    fleet.queueTransport(source!.uid, destination!.uid, { planks: 10 });
  }
  return { done: delivered(destination!, "planks", 10 * ships), fleet, seconds: 1800, sea };
};

export const SHIP_SCENARIOS: ReadonlyArray<[string, () => ShipScenario]> = [
  ["head-on", headOnScenario],
  ["busy harbour (4 ships)", busyHarbourScenario],
  ["4 visitors", fourVisitorsScenario],
  ["headland", headlandScenario],
  ["flush berth", flushBerthScenario]
];
