import { blockedWalkAction, nextBlockedSeconds } from "../../src/app/settlement/settlement-blocked-pose";
import { WORKER_COLLISION_RADIUS, WORKER_RADIUS } from "../../src/render-common/workers/worker-dimensions";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isOwnDoorLane, isOwnStockCourtyard } from "../../src/shared/settlement/settlement-entrance";
import { updateCarrier } from "../../src/shared/settlement/settlement-logistics";
import { isNavigationFootprintClear } from "../../src/shared/settlement/settlement-navigation";
import {
  beginActorMovement, type MovementOutcome,
movementOutcome} from "../../src/shared/settlement/settlement-navigation-recovery";
import { moveActor } from "../../src/shared/settlement/settlement-paths";
import { beginPersonTrafficTick } from "../../src/shared/settlement/settlement-person-index";
import { updateStationaryRoadYield } from "../../src/shared/settlement/settlement-road-shoulders";
import { actorSeparation } from "../../src/shared/settlement/settlement-traffic";
import {
  resetTrafficWork, snapshotTrafficWork, type TrafficWorkCounters
} from "../../src/shared/settlement/settlement-traffic-counters";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "../../src/shared/settlement/settlement-types";
import { waitingFocus } from "../../src/shared/settlement/settlement-waiting-heading";

/**
 * One shared traffic scenario harness: a small deterministic world, the simulation's own
 * per-tick traffic calls, and one metric vocabulary that every crowd-motion change is judged by.
 */
const TICK = 0.05;
const WAITING_OUTCOMES = new Set<MovementOutcome>(["door-queue", "stock-wait", "yield-wait"]);
const ATTRIBUTABLE_OUTCOMES = new Set<MovementOutcome>([
  "door-queue", "stock-wait", "yield-wait", "arrived", "interaction"
]);
const FACING_OUTCOMES = new Set<MovementOutcome>(["door-queue", "stock-wait", "yield-wait", "person-blocked"]);

export interface TrafficWorld {
  context: SettlementContext;
  occupied: Uint8Array;
  roads: ReturnType<typeof createRoadNetwork>;
  routeCalls: () => number;
  size: number;
  world: SettlementContext["options"]["world"];
}

export const createTrafficWorld = (size = 24): TrafficWorld => {
  const world = {
    blocking: new Uint8Array(size ** 2), buildRevision: 0, cellsX: size, cellsZ: size,
    heights: new Float32Array((size + 1) ** 2),
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() },
    walkCost: new Uint8Array(size ** 2).fill(10)
  } as unknown as SettlementContext["options"]["world"];
  const occupied = new Uint8Array(size ** 2);
  const roads = createRoadNetwork(world as never, {
    isBlocked: (x, z) => occupied[Math.floor(z) * size + Math.floor(x)] === 1
  });
  let calls = 0;
  const route = roads.route.bind(roads);
  roads.route = (from, to) => { calls++; return route(from, to); };
  const context = {
    actors: [], buildings: [], nextActor: 1000, occupied, options: { roads, world }, reservations: new Set()
  } as unknown as SettlementContext;
  return { context, occupied, roads, routeCalls: () => calls, size, world };
};

/** Marks one cell unwalkable (walls, corridor sides). */
const blockCell = (scene: TrafficWorld, x: number, z: number) => {
  scene.world.walkCost[z * scene.size + x] = 0;
};
/** A wall along x = column with optional open rows (gates). */
export const buildWallColumn = (scene: TrafficWorld, column: number, gates: readonly number[] = []) => {
  for (let z = 0; z < scene.size; z++) if (!gates.includes(z)) blockCell(scene, column, z);
};
/** A straight corridor of `width` open rows starting at row `z`, walled above and below. */
export const buildCorridor = (scene: TrafficWorld, z: number, width: number, from = 0, to = scene.size) => {
  for (let x = from; x < to; x++) { blockCell(scene, x, z - 1); blockCell(scene, x, z + width); }
};

export interface PlotSpec {
  depth: number; doorRotation: 0 | 1 | 2 | 3; job?: string; stock?: boolean; typeId?: number;
  uid: number; width: number; x: number; z: number;
}
const FRONT = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }] as const;
/** A finished plot whose door faces 0/90/180/270 degrees; its footprint cells are occupied. */
export const addPlot = (scene: TrafficWorld, spec: PlotSpec): SettlementBuilding => {
  const front = FRONT[spec.doorRotation]!;
  const halfFront = Math.abs(front.x) ? spec.width / 2 : spec.depth / 2;
  const at = (offset: number) => ({ x: spec.x + front.x * offset, z: spec.z + front.z * offset });
  const building = {
    access: at(halfFront + .5), accepts: {}, construction: 1, cycle: 0, depth: spec.depth, door: 0,
    doorThreshold: at(halfFront - .05), hasDoor: true, incoming: {}, input: {}, inventory: {}, output: {},
    required: {}, rotation: spec.doorRotation, selected: false, status: "", typeId: spec.typeId ?? 5,
    uid: spec.uid, width: spec.width, workerApproach: at(halfFront + .22), working: false,
    x: spec.x, y: 0, z: spec.z
  } as unknown as SettlementBuilding;
  for (let z = Math.floor(spec.z - spec.depth / 2); z < Math.ceil(spec.z + spec.depth / 2); z++)
    for (let x = Math.floor(spec.x - spec.width / 2); x < Math.ceil(spec.x + spec.width / 2); x++)
      scene.occupied[z * scene.size + x] = 1;
  scene.context.buildings.push(building);
  return building;
};

export interface ActorSpec {
  action?: SettlementActor["action"]; building?: number; home?: number; job?: string;
  path?: SettlementPoint[]; phase?: string; uid: number; visible?: boolean; ware?: string | null;
  x: number; yaw?: number; z: number;
}
export const addActor = (scene: TrafficWorld, spec: ActorSpec): SettlementActor => {
  const job = spec.job ?? "Woodcutter";
  const path = spec.path ?? [];
  const actor = {
    action: spec.action ?? (path.length ? "walk" : "idle"), animationTime: 0,
    building: spec.building ?? 0, home: spec.home ?? 0, job, path, pathIndex: 0,
    phase: spec.phase ?? "outbound", timer: 0, uid: spec.uid, visible: spec.visible ?? true,
    ware: spec.ware === undefined ? null : spec.ware, x: spec.x, y: 0, yaw: spec.yaw ?? 0, z: spec.z
  } as SettlementActor;
  scene.context.actors.push(actor);
  return actor;
};
/** A carrier/worker following an actual road route between two road points. */
export const addRoadWalker = (scene: TrafficWorld, spec: ActorSpec & { to: SettlementPoint }) => {
  const route = scene.roads.route({ x: spec.x, z: spec.z }, spec.to);
  if (!route) throw new Error(`No road route from ${spec.x},${spec.z}`);
  return addActor(scene, { phase: "deliver", ...spec, path: route.points });
};

export interface TrafficMetrics {
  bystanderDisplacement: number;
  completed: number;
  footprintClips: number;
  headingReversals: number;
  maxPathExcess: number;
  noProgressViolations: number;
  overlaps: number;
  pathExcess: number[];
  /** Sidestep end points whose collision footprint clips a wall or foundation. */
  queueEndpointClips: number;
  /** Ticks a unit stood (>0.15 s) where its body footprint clips a wall or foundation. */
  standingClips: number;
  waiterDrift: number;
  waitingFacingSamples: number;
  waitingFacedSamples: number;
  waitingWalked: number;
  walked: number[];
  walkPoseWhileStill: number;
  work: TrafficWorkCounters & { routeCalls: number };
  yieldWait: number;
}
export interface RunOptions {
  /** Per-tick hook after all actors moved (scripted bystanders, assertions). */
  afterTick?: (elapsed: number) => void;
  /** Carriers driven by the full carrier state machine instead of plain path following. */
  carriers?: readonly SettlementActor[];
  scene?: TrafficWorld;
}
const routeLength = (actor: SettlementActor) => {
  let length = 0;
  let previous: SettlementPoint = actor;
  for (let index = actor.pathIndex; index < actor.path.length; index++) {
    const point = actor.path[index]!;
    length += Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return length;
};
const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/**
 * Mirrors the renderer: a walk stride unless the blocked pose replaced it, a loaded stride only while
 * the unit's outcome is moving (otherwise it stands with its load).
 */
const isWalkPoseWhileStill = (
  actor: SettlementActor, outcome: MovementOutcome, blockedSeconds: number, moved: number, stillSeconds: number
) => {
  if (!actor.visible || moved >= 0.001 || stillSeconds <= 0.15) return false;
  if (actor.action === "carry") return outcome === "moving";
  return actor.action === "walk" && blockedWalkAction("walk", blockedSeconds) === "walk";
};

interface MoverTrack {
  queueTarget?: SettlementPoint;
  best: number; bestIndex: number; blocked: number; heading?: SettlementPoint; route: number; since: number;
  still: number; waitStart?: SettlementPoint & { walked: number }; walked: number;
}
const createTrack = (actor: SettlementActor): MoverTrack => ({
  best: routeLength(actor), bestIndex: actor.pathIndex, blocked: 0, route: routeLength(actor), since: 0, still: 0,
  walked: 0
});

/** Deterministic loop with the simulation's own traffic calls in its own order. */
export const runTraffic = (
  context: SettlementContext, movers: readonly SettlementActor[], seconds: number, options: RunOptions = {}
): TrafficMetrics => {
  resetTrafficWork();
  const startRoutes = options.scene?.routeCalls() ?? 0;
  const metrics: TrafficMetrics = {
    bystanderDisplacement: 0, completed: 0, footprintClips: 0, headingReversals: 0, maxPathExcess: 0,
    noProgressViolations: 0, overlaps: 0, pathExcess: [], queueEndpointClips: 0, standingClips: 0, waiterDrift: 0, waitingFacedSamples: 0,
    waitingFacingSamples: 0, waitingWalked: 0, walked: [], walkPoseWhileStill: 0,
    work: { ...snapshotTrafficWork(), routeCalls: 0 }, yieldWait: 0
  };
  const moving = new Set(movers);
  const carriers = new Set(options.carriers ?? []);
  const finished = new Set<SettlementActor>();
  const tracks = new Map(movers.map(actor => [actor, createTrack(actor)]));
  const bystanders = context.actors.filter(actor => !moving.has(actor))
    .map(actor => ({ actor, x: actor.x, z: actor.z }));
  const ticks = Math.round(seconds / TICK);
  for (let tick = 0; tick < ticks; tick++) {
    beginPersonTrafficTick(context);
    for (const actor of context.actors.slice()) {
      beginActorMovement(actor);
      if (updateStationaryRoadYield(context, actor, TICK)) continue;
      if (!moving.has(actor) || finished.has(actor)) continue;
      const before = { x: actor.x, z: actor.z };
      const done = carriers.has(actor) ? (updateCarrier(context, actor, TICK), false)
        : moveActor(context, actor, TICK);
      if (done) finished.add(actor);
      sampleMover(context, actor, before, tracks.get(actor)!, metrics);
    }
    options.afterTick?.((tick + 1) * TICK);
    countOverlaps(context, metrics);
  }
  for (const actor of movers) {
    const track = tracks.get(actor)!;
    metrics.walked.push(track.walked);
    metrics.pathExcess.push(track.walked - track.route);
  }
  metrics.completed = finished.size;
  metrics.maxPathExcess = Math.max(0, ...metrics.pathExcess);
  metrics.bystanderDisplacement = Math.max(0, ...bystanders.map(entry =>
    Math.hypot(entry.actor.x - entry.x, entry.actor.z - entry.z)));
  metrics.work = { ...snapshotTrafficWork(), routeCalls: (options.scene?.routeCalls() ?? 0) - startRoutes };
  return metrics;
};

const sampleMover = (
  context: SettlementContext, actor: SettlementActor, before: SettlementPoint, track: MoverTrack,
  metrics: TrafficMetrics
) => {
  const dx = actor.x - before.x, dz = actor.z - before.z, moved = Math.hypot(dx, dz);
  const outcome = movementOutcome(actor);
  track.walked += moved;
  if (outcome === "yield-wait") metrics.yieldWait += TICK;
  track.still = moved < 0.001 ? track.still + TICK : 0;
  track.blocked = nextBlockedSeconds(track.blocked, outcome, moved, TICK);
  if (isWalkPoseWhileStill(actor, outcome, track.blocked, moved, track.still)) metrics.walkPoseWhileStill += TICK;
  sampleHeading(track, dx, dz, moved, metrics);
  sampleWaiting(actor, track, outcome, moved, metrics);
  sampleFacing(actor, outcome, track, metrics);
  sampleProgress(actor, track, outcome, metrics);
  sampleClips(context, actor, track, metrics);
};
const sampleClips = (context: SettlementContext, actor: SettlementActor, track: MoverTrack, metrics: TrafficMetrics) => {
  if (!actor.visible) return;
  const ownGround = (point: SettlementPoint) =>
    isOwnDoorLane(context, actor, point) || isOwnStockCourtyard(context, actor, point);
  if (!isNavigationFootprintClear(context, actor, ownGround, WORKER_RADIUS)) metrics.footprintClips++;
  if (track.still > 0.15 && !isNavigationFootprintClear(context, actor, ownGround, WORKER_RADIUS))
    metrics.standingClips++;
  const queued = actor.queueTarget;
  if (!queued || queued === track.queueTarget) return;
  track.queueTarget = queued;
  if (!isNavigationFootprintClear(context, queued, ownGround, WORKER_COLLISION_RADIUS)) metrics.queueEndpointClips++;
};
const sampleHeading = (track: MoverTrack, dx: number, dz: number, moved: number, metrics: TrafficMetrics) => {
  if (moved < 1e-6) return;
  const heading = { x: dx / moved, z: dz / moved };
  if (track.heading && track.heading.x * heading.x + track.heading.z * heading.z < -0.5)
    metrics.headingReversals++;
  track.heading = heading;
};
const sampleWaiting = (
  actor: SettlementActor, track: MoverTrack, outcome: MovementOutcome, moved: number, metrics: TrafficMetrics
) => {
  const progressed = actor.pathIndex > track.bestIndex;
  if (track.waitStart && progressed) track.waitStart = undefined;
  if (!track.waitStart && WAITING_OUTCOMES.has(outcome))
    track.waitStart = { walked: 0, x: actor.x, z: actor.z };
  if (!track.waitStart) return;
  track.waitStart.walked += moved;
  metrics.waitingWalked = Math.max(metrics.waitingWalked, track.waitStart.walked);
  metrics.waiterDrift = Math.max(metrics.waiterDrift,
    Math.hypot(actor.x - track.waitStart.x, actor.z - track.waitStart.z));
};
const sampleFacing = (
  actor: SettlementActor, outcome: MovementOutcome, track: MoverTrack, metrics: TrafficMetrics
) => {
  if (!actor.visible || !FACING_OUTCOMES.has(outcome) || track.still <= 0.15) return;
  const focus = waitingFocus(actor);
  if (!focus) return;
  metrics.waitingFacingSamples++;
  const heading = Math.atan2(focus.x - actor.x, focus.z - actor.z);
  if (angleBetween(heading, actor.yaw) <= Math.PI / 4) metrics.waitingFacedSamples++;
};
/** A visible actor with a path must shorten its remaining route by 0.25 within 8 s, or be waiting. */
const sampleProgress = (
  actor: SettlementActor, track: MoverTrack, outcome: MovementOutcome, metrics: TrafficMetrics
) => {
  const remaining = routeLength(actor);
  if (actor.pathIndex > track.bestIndex || remaining < track.best - 0.25 || ATTRIBUTABLE_OUTCOMES.has(outcome) ||
    !actor.visible || actor.pathIndex >= actor.path.length) {
    track.best = Math.min(track.best, remaining); track.bestIndex = actor.pathIndex; track.since = 0;
    return;
  }
  track.since += TICK;
  if (track.since < 8) return;
  metrics.noProgressViolations++;
  track.since = 0;
};
const countOverlaps = (context: SettlementContext, metrics: TrafficMetrics) => {
  const visible = context.actors.filter(actor => actor.visible);
  for (let first = 0; first < visible.length; first++)
    for (let second = first + 1; second < visible.length; second++) {
      const a = visible[first]!, b = visible[second]!;
      if (Math.hypot(a.x - b.x, a.z - b.z) < actorSeparation(a, b) - 1e-6) metrics.overlaps++;
    }
};

/** Stable hash of the traffic-relevant actor state (positions to 1e-4, path progress, phase). */
const trafficStateHash = (context: SettlementContext) => context.actors.map(actor =>
  [actor.uid, actor.x.toFixed(4), actor.z.toFixed(4), actor.pathIndex, actor.phase,
    actor.queueTarget ? `${actor.queueTarget.x.toFixed(4)},${actor.queueTarget.z.toFixed(4)}` : "-"]
    .join(":")).join("|");

export interface ScenarioBuild { movers: SettlementActor[]; scene: TrafficWorld }
/** Runs `build` uninterrupted and with a JSON save/load round trip at `saveAt` seconds. */
export const runSaveLoadVariant = (build: () => ScenarioBuild, saveAt: number, continueFor: number) => {
  const continued = build();
  runTraffic(continued.scene.context, continued.movers, saveAt, { scene: continued.scene });
  const saved = JSON.stringify(continued.scene.context.actors);
  const pending = (scenario: ScenarioBuild) =>
    scenario.scene.context.actors.filter(actor => scenario.movers.some(mover => mover.uid === actor.uid));
  const loaded = build();
  loaded.scene.context.actors.splice(0, loaded.scene.context.actors.length, ...JSON.parse(saved));
  const loadedMetrics = runTraffic(loaded.scene.context, pending(loaded), continueFor, { scene: loaded.scene });
  const continuedMetrics = runTraffic(continued.scene.context, pending(continued), continueFor,
    { scene: continued.scene });
  return {
    continued: { hash: trafficStateHash(continued.scene.context), metrics: continuedMetrics },
    loaded: { hash: trafficStateHash(loaded.scene.context), metrics: loadedMetrics },
    saved: JSON.parse(saved) as SettlementActor[]
  };
};
/** Builds and runs a scenario twice; equal hashes prove the loop is deterministic. */
export const runTwice = (build: () => ScenarioBuild, seconds: number) => [build(), build()].map(scenario => {
  runTraffic(scenario.scene.context, scenario.movers, seconds, { scene: scenario.scene });
  return trafficStateHash(scenario.scene.context);
});
