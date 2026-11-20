import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { createCamera } from "../../render-common/camera-state";
import { harvestCarcass, isCarcass } from "../../render-common/helpers";
import { createAnimalManager } from "../../render-common/wildlife/animal-manager";
import type { AnimalSaveState } from "../../render-common/wildlife/manager/animal-save";
import { createIslandNav } from "../../render-common/wildlife/nav/island-nav";
import { ANIMAL_STATE } from "../../render-common/wildlife/wildlife-species";
import { PRODUCTION_OUTPUT_CAPACITY } from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { savedOccupancy } from "../../shared/settlement/save-cell-codecs";
import { HUNT_DRAW_SECONDS, HUNT_RELEASE_PROGRESS, huntingApproaches } from "../../shared/settlement/settlement-hunting";
import type { Goods, SettlementBuilding, SettlementPoint } from "../../shared/settlement/settlement-types";
import { resourceWorkRadius } from "../../shared/settlement/settlement-work-ranges";
import { productionCycleRate } from "../../shared/settlement/workshop-upgrades";
import type { WorldData } from "../../shared/world/world-data";
import { createIslandFelling } from "../island-felling";
import { createIslandGrowth } from "../island-growth";
import type { GameRuntimeState } from "./game-session";
import type { OfflineEconomyEventsResult, OfflineEconomyJob } from "./offline-economy-events";

export interface OfflineWildlifeHunt {
  hunterUid: number;
  animalId: number;
  acquiredSeconds: number;
  killedSeconds: number;
  deliveredSeconds: number;
  walkDistance: number;
  walkSpeed: number;
}
export interface OfflineEconomyWildlifeOptions {
  /** Native lifecycle functions use this deterministic movement/decision step; default1s. */
  stepSeconds?: number;
  islandId?: string;
  /** Completed source timeline, relative to this window; native forest targets and threats follow it. */
  treeFellings?: readonly { seconds: number; treeId: number }[];
}
export interface OfflineEconomyWildlife {
  stock: Goods;
  jobs: OfflineEconomyJob[];
  hunts: OfflineWildlifeHunt[];
  animals: AnimalSaveState | undefined;
  steps: number;
  notes: string[];
  /** Apply after existing output claims; missing warehouse credits remain on the hunter's shelf. */
  apply: (completedCycles: Readonly<Record<string, number>>, ledger: OfflineEconomyEventsResult["islands"][number]) => void;
}

const distance = (a: SettlementPoint, b: SettlementPoint) => DMath.hypot(a.x - b.x, a.z - b.z);

type MatureTreeTest = (id: number) => boolean;

/**
 * Which tree props stand mature at the window's start (the saved felling and growth states, as
 * a reload restores them): the wildlife regions count these.
 */
const createMatureTreeTest = (world: WorldData, runtime: GameRuntimeState | undefined): MatureTreeTest | undefined => {
  if (!runtime?.growth || !runtime.felling) return undefined;
  const growth = createIslandGrowth(world, id => felling.isStanding(id));
  const felling = createIslandFelling({ camera: createCamera(world.start.x, world.start.z, .2), world,
    canFell: id => !growth.isGrowing(id), isGrown: growth.isGrown, onFelled: () => undefined,
    onRemoved: () => undefined, project: () => ({ x: 0, y: 0, depth: 0 }) });
  growth.loadState(runtime.growth);
  felling.loadState(runtime.felling);
  return id => felling.isStanding(id) && !growth.isGrowing(id);
};

/**
 * The island's own wildlife manager on coarse steps: native respawn ledger, births, maturation,
 * wandering, escape, death and RNG; dormant regions cost nothing; only the movement step differs.
 */
const createCoarseWildlife = (world: WorldData, saved: AnimalSaveState, isMatureTree?: MatureTreeTest) => {
  const manager = createAnimalManager(world, createIslandNav(world, []), saved, [], { isMatureTree });
  return {
    manager,
    pool: manager.debug.pool,
    step: manager.stepCoarse,
    hit: manager.hitHuntedAnimal,
    treeFelled: (tree: number) => {
      manager.onTreeFelled(tree);
      manager.onThreat({ intensity: .65, position: { x: world.props.x[tree]!, z: world.props.z[tree]! } });
    },
    save: manager.saveState
  };
};

type Hunter = {
  building: SettlementBuilding;
  point: SettlementPoint;
  rate: number;
  speed: number;
  cells: Set<number>;
  walked: number;
};
const hunterReach = (save: GameSaveV1, world: WorldData, building: SettlementBuilding) => {
  const cells = new Set<number>(), pending: number[] = [], occupied = savedOccupancy(save.settlement);
  const first = Math.floor(building.access.z) * world.cellsX + Math.floor(building.access.x);
  cells.add(first); pending.push(first);
  const radius = resourceWorkRadius("wildlife") + 20;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const cell = pending[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!, nz = z + dz!, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || cells.has(next) ||
        !world.walkCost[next] || occupied[next] === 1 ||
        DMath.hypot(nx + .5 - building.x, nz + .5 - building.z) > radius) continue;
      cells.add(next); pending.push(next);
    }
  }
  return cells;
};
const hunterPath = (hunter: Hunter, to: SettlementPoint, world: WorldData): SettlementPoint[] | undefined => {
  const cell = (point: SettlementPoint) => Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  const first = cell(hunter.point), goal = cell(to);
  if (!hunter.cells.has(goal)) return undefined;
  const parents = new Map<number, number>([[first, -1]]), pending = [first];
  for (let cursor = 0; cursor < pending.length && !parents.has(goal); cursor++) {
    const current = pending[cursor]!;
    const x = current % world.cellsX;
    const neighbors = [current - world.cellsX, current + world.cellsX];
    if (x > 0) neighbors.push(current - 1);
    if (x + 1 < world.cellsX) neighbors.push(current + 1);
    for (const next of neighbors) {
      if (!hunter.cells.has(next) || parents.has(next)) continue;
      parents.set(next, current); pending.push(next);
    }
  }
  if (!parents.has(goal)) return undefined;
  const path: SettlementPoint[] = [{ ...to }];
  let current = goal;
  while (current !== first) {
    path.push({ x: current % world.cellsX + .5, z: Math.floor(current / world.cellsX) + .5 });
    current = parents.get(current)!;
  }
  return path.reverse();
};
const move = (hunter: Hunter, path: SettlementPoint[], dt: number) => {
  let remaining = hunter.speed * dt;
  while (path.length) {
    const point = path[0]!, length = distance(hunter.point, point);
    if (length > remaining) {
      hunter.point.x += (point.x - hunter.point.x) * remaining / length;
      hunter.point.z += (point.z - hunter.point.z) * remaining / length;
      hunter.walked += remaining;
      return false;
    }
    hunter.point = point; remaining -= length; hunter.walked += length; path.shift();
  }
  return true;
};

/**
 * A bounded wildlife-only simulation, without settlement traffic ticks. Native animal lifecycle
 * and its saved RNG advance throughout the whole interval. One hunter works at a time; terrain
 * paths, real two-shot escapes, death fall, collection and walking home precede each meat award.
 * An unfinished final hunt rolls back to its checkpoint and the remaining wildlife time advances
 * without that hunt, preserving a coherent population instead of leaving unowned animal cargo.
 */
export const prepareOfflineEconomyWildlife = (
  save: GameSaveV1, world: WorldData, seconds: number, options: OfflineEconomyWildlifeOptions = {}
): OfflineEconomyWildlife => {
  const step = options.stepSeconds ?? 1;
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.round(seconds * 1000)))
    throw new Error("Invalid wildlife horizon");
  if (![.05, .25, .5, 1].includes(step)) throw new Error("Unsupported wildlife step");
  const saved = (save.runtime as GameRuntimeState | undefined)?.animals;
  const islandId = options.islandId ?? "home", notes: string[] = [];
  const fellings = [...options.treeFellings ?? []].sort((a, b) => a.seconds - b.seconds || a.treeId - b.treeId);
  if (fellings.some(event => !Number.isFinite(event.seconds) || event.seconds < 0 ||
    !Number.isSafeInteger(event.treeId) || event.treeId < 0 || event.treeId >= world.props.count))
    throw new Error("Invalid wildlife tree-felling event");
  let fellingIndex = 0;
  const stock: Goods = {}, jobs: OfflineEconomyJob[] = [], hunts: OfflineWildlifeHunt[] = [];
  if (!saved) return { stock, jobs, hunts, animals: undefined, steps: 0,
    notes: ["No native saved wildlife; hunting deferred."], apply: () => {} };
  const isMatureTree = createMatureTreeTest(world, save.runtime as GameRuntimeState | undefined);
  let runtime = createCoarseWildlife(world, saved, isMatureTree), steps = 0;
  const talents = talentModifiers(save.player?.talents);
  const hunters: Hunter[] = [];
  const reservedPrey = new Set(save.settlement.actors.flatMap(actor => [actor.target, actor.preparedTarget])
    .filter(target => target?.kind === "wildlife").map(target => target!.id));
  for (const building of save.settlement.buildings) {
    if (building.typeId !== 22 || building.construction !== 1 || building.militaryFaction || building.productionPaused) continue;
    const actor = save.settlement.actors.find(actor => actor.uid === building.worker);
    if (!actor || actor.target || actor.preparedTarget || actor.ware || actor.productionSeconds !== undefined) {
      notes.push(`Hunter ${building.uid}: original committed work retained; new hunts deferred.`); continue;
    }
    hunters.push({ building, point: { ...building.access },
      rate: productionCycleRate(building, talents.productionSpeed + talents.hunterFisherSpeed),
      speed: .9, cells: hunterReach(save, world, building), walked: 0 });
  }
  type ActiveHunt = { hunter: Hunter; animal: number; phase: "chase" | "aim" | "flight" | "collect" | "return" | "handoff";
    timer: number; path?: SettlementPoint[]; pathTarget?: SettlementPoint; acquired: number; killed: number; harvested: boolean;
    walkedAtStart: number;
    checkpoint: AnimalSaveState; checkpointTime: number };
  let active: ActiveHunt | undefined;
  let searchAt = 0;
  const totalTicks = Math.floor(seconds / TICK_SECONDS + 1e-6);
  const coarseTicks = Math.round(step / TICK_SECONDS);
  for (let tick = 0; tick < totalTicks;) {
    const deltaTicks = Math.min(coarseTicks, totalTicks - tick), dt = deltaTicks * TICK_SECONDS;
    runtime.step(dt); steps++; tick += deltaTicks;
    const elapsed = tick * TICK_SECONDS, pool = runtime.pool;
    let acquiredNow = false;
    while (fellingIndex < fellings.length && fellings[fellingIndex]!.seconds <= elapsed) {
      runtime.treeFelled(fellings[fellingIndex]!.treeId); fellingIndex++;
    }
    if (!active && elapsed >= searchAt) {
      searchAt = elapsed + 1;
      for (const hunter of hunters) {
        let selected = -1, nearest = Infinity;
        // The same prey scan as an online hunter: it wakes the wildlife regions it searches.
        const scan = runtime.manager.listHuntTargets("wildlife", hunter.building, resourceWorkRadius("wildlife"));
        for (const prey of scan) {
          if (reservedPrey.has(prey.id)) continue;
          const length = distance(hunter.point, prey);
          if (length >= nearest || !hunter.cells.has(Math.floor(prey.z) * world.cellsX + Math.floor(prey.x))) continue;
          nearest = length; selected = prey.id;
        }
        if (selected < 0) continue;
        active = { hunter, animal: selected, phase: "chase", timer: 0, acquired: elapsed, killed: 0, harvested: false,
          walkedAtStart: hunter.walked, checkpoint: runtime.save(), checkpointTime: elapsed };
        acquiredNow = true;
        break;
      }
    }
    if (!active) continue;
    // A prey first observed at this boundary cannot consume walking time from the preceding step.
    if (acquiredNow) continue;
    const { animal, hunter } = active;
    // A pursued prey keeps its region simulated, as an online hunter's target checks do.
    runtime.manager.ensureSimulated(animal);
    const point = { x: pool.x[animal]!, z: pool.z[animal]! };
    const alive = pool.active[animal] === 1;
    if (active.phase === "handoff") {
      active.timer -= dt;
      if (active.timer > 0) continue;
      if (active.harvested) hunts.push({ hunterUid: hunter.building.uid, animalId: animal, acquiredSeconds: active.acquired,
        killedSeconds: active.killed, deliveredSeconds: elapsed,
        walkDistance: hunter.walked - active.walkedAtStart, walkSpeed: hunter.speed });
      active = undefined;
      continue;
    }
    if (active.phase === "return") {
      if (!active.path || !move(hunter, active.path, dt)) continue;
      active.phase = "handoff"; active.timer = 1 + 2 / hunter.rate;
      continue;
    }
    if (active.phase === "collect") {
      if (!pool.carcass[animal]) {
        active.phase = "return"; active.path = hunterPath(hunter, hunter.building.access, world); continue;
      }
      active.path ??= hunterPath(hunter, point, world);
      if (!active.path) {
        active.phase = "return"; active.path = hunterPath(hunter, hunter.building.access, world); continue;
      }
      if (!move(hunter, active.path, dt) || !isCarcass(pool, animal)) continue;
      if (!harvestCarcass(pool, animal)) continue;
      active.harvested = true;
      active.phase = "return"; active.path = hunterPath(hunter, hunter.building.access, world);
      continue;
    }
    if (!alive) { active.phase = "collect"; active.path = undefined; continue; }
    if (active.phase === "flight") {
      active.timer -= dt;
      if (active.timer > 0) continue;
      runtime.hit(animal, hunter.point);
      if (!pool.active[animal]) active.killed = elapsed;
      active.phase = "chase"; active.path = undefined;
      continue;
    }
    const range = distance(hunter.point, point), fleeing = pool.state[animal] === ANIMAL_STATE.flee;
    if (active.phase === "aim") {
      if (range > 5 || range < 2 || fleeing) { active.phase = "chase"; active.path = undefined; continue; }
      active.timer -= dt;
      if (active.timer > 0) continue;
      active.phase = "flight"; active.timer = Math.max(.15, range / 10);
      continue;
    }
    if (range >= 2 && range <= 5 && !fleeing) {
      active.phase = "aim"; active.timer = HUNT_DRAW_SECONDS * HUNT_RELEASE_PROGRESS / hunter.rate;
      active.path = undefined;
      continue;
    }
    if (!active.path?.length || !active.pathTarget || distance(point, active.pathTarget) > 1) {
      active.path = huntingApproaches(point, hunter.point).map(target => hunterPath(hunter, target, world))
        .find(path => path !== undefined);
      if (!active.path) {
        active.phase = "return"; active.path = hunterPath(hunter, hunter.building.access, world); continue;
      }
      active.pathTarget = { ...point };
    }
    if (active.path) move(hunter, active.path, dt);
  }
  if (active) {
    notes.push(`Unfinished wildlife phase ${active.phase}, target ${active.animal}, ` +
      `hunter ${active.hunter.point.x.toFixed(2)},${active.hunter.point.z.toFixed(2)}, ` +
      `prey ${runtime.pool.x[active.animal]!.toFixed(2)},${runtime.pool.z[active.animal]!.toFixed(2)} ` +
      `state ${runtime.pool.state[active.animal]}, hunt ${runtime.pool.huntState[active.animal]}.`);
    runtime = createCoarseWildlife(world, active.checkpoint, isMatureTree);
    fellingIndex = fellings.findIndex(event => event.seconds > active!.checkpointTime);
    if (fellingIndex < 0) fellingIndex = fellings.length;
    const remainingTicks = totalTicks - Math.round(active.checkpointTime / TICK_SECONDS);
    for (let tick = 0; tick < remainingTicks; tick += coarseTicks) {
      runtime.step(Math.min(coarseTicks, remainingTicks - tick) * TICK_SECONDS); steps++;
      const elapsed = active.checkpointTime + Math.min(remainingTicks, tick + coarseTicks) * TICK_SECONDS;
      while (fellingIndex < fellings.length && fellings[fellingIndex]!.seconds <= elapsed) {
        runtime.treeFelled(fellings[fellingIndex]!.treeId); fellingIndex++;
      }
    }
    notes.push("Incomplete final hunting attempt discarded at its native population/RNG checkpoint.");
  }
  const animals = runtime.save();
  hunts.forEach((hunt, index) => {
    const token = `~wildlife:${islandId}:${index}`, uid = `wildlife:${islandId}:${index}`;
    stock[token] = 1;
    const finish = Math.max(1, Math.ceil(hunt.deliveredSeconds * 1000));
    jobs.push({ uid, islandId, inputs: { [token]: 1 }, outputs: { meat: 1 }, cycleTicks: 1,
      firstTick: finish - 1, endTick: finish, outputSequence: [{ meat: 1 }] });
  });
  let applied = false;
  return { stock, jobs, hunts, animals, steps,
    notes: [...notes, `Native wildlife lifecycle and RNG advanced for ${seconds}s with ${step}s movement steps; hunter terrain paths and one-at-a-time scheduling are approximate.`],
    apply: (completedCycles, ledger) => {
      if (applied) throw new Error("Offline wildlife already applied");
      if (ledger.islandId !== islandId) throw new Error("Offline wildlife destination mismatch");
      for (const job of jobs) {
        const count = completedCycles[job.uid] ?? 0;
        if (count !== 0 && count !== 1) throw new Error("Offline wildlife completed more than once");
      }
      // Unaccepted warehouse output still belongs to the completed hunter's shelf, never vanishes.
      const missing = new Map<number, number>();
      hunts.forEach((hunt, index) => {
        if (!(completedCycles[jobs[index]!.uid] ?? 0)) missing.set(hunt.hunterUid, (missing.get(hunt.hunterUid) ?? 0) + 1);
      });
      for (const [uid, count] of missing) {
        const building = save.settlement.buildings.find(building => building.uid === uid)!;
        if ((building.output.meat ?? 0) + count > PRODUCTION_OUTPUT_CAPACITY)
          throw new Error("Offline hunter output requires detailed capacity handling");
      }
      applied = true;
      for (const [uid, count] of missing) {
        const building = save.settlement.buildings.find(building => building.uid === uid)!;
        building.output.meat = (building.output.meat ?? 0) + count;
        ledger.produced.meat = (ledger.produced.meat ?? 0) + count;
      }
      const runtimeState = save.runtime as GameRuntimeState;
      runtimeState.animals = animals;
    } };
};
