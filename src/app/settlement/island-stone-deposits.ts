import { getKnownRocks } from "../../render-common/rocks/island-rock-instances";
import { ROCK_ROLE, type RockInstance } from "../../render-common/rocks/rock-instances";
import { DMath } from "../../shared/math/deterministic-math";
import { createMountainStoneDeposits } from "../../shared/settlement/island-mountain-stone";
import { overlapsSettlementGround } from "../../shared/settlement/settlement-ground-clearance";
import type { ResourceTarget, SettlementPoint } from "../../shared/settlement/settlement-types";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import { BLOCKING, PROP, PROP_REMOVED, type WorldData } from "../../shared/world/world-data";
import { FORMATION_ID_FLOOR, formationKey, type IslandStoneLedgerState } from "./island-stone-ledger";

const extent = (rock: RockInstance, axis: number) =>
  rock.axes.reduce((sum, vector) => sum + Math.abs(vector[axis]!), 0) / 2;
const freshFormationAmount = (rock: RockInstance) => {
  const volume = extent(rock, 0) * extent(rock, 1) * extent(rock, 2) * 8;
  return Math.max(6, Math.min(24, Math.ceil(volume * 4)));
};

/** Finite quarry chunks belong to the actual visible formations; mining never removes a mountain mesh. */
export const createIslandStoneDeposits = (
  world: WorldData,
  onPropDepleted: (id: number) => void,
  saved?: IslandStoneLedgerState
) => {
  const mountain = createMountainStoneDeposits(world);
  let nextId = saved?.nextId ?? -1;
  let exhaustedCache: number[] | undefined;
  const identities = new WeakMap<RockInstance, number>();
  const deposits = new Map<number, { rock: RockInstance; remaining: number }>();
  const propRemaining = new Map<number, number>(saved?.props);
  /** Saved formations not met again yet: they keep their id and amount until a query finds them. */
  const pendingFormations = new Map(saved?.formations.map(([id, x, z, remaining]) =>
    [formationKey(x, z), { id, remaining, x, z }]));
  if (saved) mountain.loadState(saved.seams);
  const dry = (point: SettlementPoint) => {
    if (point.x < .3 || point.z < .3 || point.x >= world.cellsX - .3 || point.z >= world.cellsZ - .3) return false;
    const cell = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
    return Boolean(world.walkCost[cell]) && sampleSmooth(world, world.heights, point.x, point.z) > world.seaLevel + .08;
  };
  const cleared = (x: number, z: number, rx = .6, rz = rx) =>
    overlapsSettlementGround(world, x - rx, z - rz, x + rx, z + rz);
  const rockCleared = (rock: RockInstance) => cleared(rock.centre[0], rock.centre[2], extent(rock, 0), extent(rock, 2));
  const register = (rock: RockInstance) => {
    const known = identities.get(rock);
    if (known !== undefined) return known;
    const key = formationKey(rock.centre[0], rock.centre[2]);
    const restored = pendingFormations.get(key);
    pendingFormations.delete(key);
    const id = restored?.id ?? nextId--;
    identities.set(rock, id);
    exhaustedCache = undefined;
    deposits.set(id, { rock, remaining: restored?.remaining ?? freshFormationAmount(rock) });
    return id;
  };
  const formationTargets = (rock: RockInstance, id: number, near: SettlementPoint, range: number, includeDepleted: boolean) => {
    const rx = extent(rock, 0), rz = extent(rock, 2), ry = extent(rock, 1);
    const candidates: ResourceTarget[] = [];
    // Rectangular exterior offsets conservatively clear every transformed rock axis.
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      const sx = DMath.sin(angle), sz = DMath.cos(angle);
      const face = { x: rock.centre[0] + sx * rx, z: rock.centre[2] + sz * rz };
      const approach = { x: face.x + sx * .42, z: face.z + sz * .42 };
      if (!dry(approach) || DMath.hypot(face.x - near.x, face.z - near.z) > range) continue;
      const y = sampleSmooth(world, world.heights, approach.x, approach.z);
      // Do not quarry submerged coastal pieces or inaccessible upper floating faces.
      if (rock.centre[1] + ry < y + .15 || rock.centre[1] - ry > y + 1.2) continue;
      const target: ResourceTarget = { id, kind: "stone", ...face, y, approach };
      if (canConsume(target, includeDepleted)) candidates.push(target);
    }
    candidates.sort((a, b) => DMath.hypot(a.approach!.x - near.x, a.approach!.z - near.z) -
      DMath.hypot(b.approach!.x - near.x, b.approach!.z - near.z));
    return candidates;
  };
  const targets = (near: SettlementPoint, range: number, includeDepleted = false): ResourceTarget[] => {
    if (world.colonyResourceTier !== undefined) return [];
    const result: ResourceTarget[] = [];
    for (let id = 0; id < world.props.count; id++) {
      if (world.props.types[id] !== PROP.largeRock && !(includeDepleted && world.props.types[id] === PROP_REMOVED && propRemaining.get(id) === 0)) continue;
      const x = world.props.x[id]!, z = world.props.z[id]!;
      const target: ResourceTarget = { id, kind: "stone", x, z };
      if (canConsume(target, includeDepleted) && DMath.hypot(x - near.x, z - near.z) <= range) result.push(target);
    }
    for (const rock of getKnownRocks(world)) {
      if (rockCleared(rock)) continue;
      if (rock.role === ROCK_ROLE.pebble || rock.role === ROCK_ROLE.rubble) continue;
      const rx = extent(rock, 0), rz = extent(rock, 2), ry = extent(rock, 1);
      if (Math.max(rx, rz) < .3 || ry < .18) continue;
      const id = register(rock);
      if (!includeDepleted && deposits.get(id)!.remaining <= 0) continue;
      const candidates = formationTargets(rock, id, near, range, includeDepleted);
      if (candidates[0]) result.push(candidates[0]);
    }
    return [...result, ...mountain.targets(near, range, includeDepleted)];
  };
  const remaining = (target: ResourceTarget) => target.id >= 0 ? propRemaining.get(target.id) ?? 6
    : target.id <= FORMATION_ID_FLOOR ? mountain.amount(target.id) : deposits.get(target.id)?.remaining ?? 0;
  const freshAmount = (target: ResourceTarget) => target.id >= 0 ? 6 : target.id <= FORMATION_ID_FLOOR ? 12
    : deposits.has(target.id) ? freshFormationAmount(deposits.get(target.id)!.rock) : 0;
  /** Discovery, extraction and the offline source budget share this nonmutating predicate. */
  const canConsume = (target: ResourceTarget, includeDepleted = false) => {
    if (world.colonyResourceTier !== undefined || target.kind !== "stone" || cleared(target.x, target.z)) return false;
    if (target.id >= 0) {
      return (world.props.types[target.id] === PROP.largeRock ||
        (includeDepleted && propRemaining.get(target.id) === 0 && world.props.types[target.id] === PROP_REMOVED)) &&
        (includeDepleted || remaining(target) > 0) &&
        DMath.hypot(world.props.x[target.id]! - target.x, world.props.z[target.id]! - target.z) < .01;
    }
    if (target.id <= FORMATION_ID_FLOOR) return mountain.canConsume(target, includeDepleted);
    const deposit = deposits.get(target.id);
    return !!deposit && !rockCleared(deposit.rock) && (includeDepleted || deposit.remaining > 0) &&
      getKnownRocks(world).includes(deposit.rock) && !!target.approach && dry(target.approach);
  };
  const consume = (target: ResourceTarget) => {
    if (!canConsume(target)) return false;
    exhaustedCache = undefined;
    if (target.id >= 0) {
      const amount = remaining(target);
      propRemaining.set(target.id, amount - 1);
      if (amount === 1) onPropDepleted(target.id);
      return true;
    }
    if (target.id <= FORMATION_ID_FLOOR) return mountain.consume(target);
    deposits.get(target.id)!.remaining--;
    return true;
  };
  /** A respawned boulder (same prop) is a fresh one. */
  const refillProp = (id: number) => {
    propRemaining.delete(id);
    exhaustedCache = undefined;
  };
  const saveState = (): IslandStoneLedgerState => {
    const formations: IslandStoneLedgerState["formations"] = [];
    for (const [id, { remaining, rock }] of deposits) formations.push([id, rock.centre[0], rock.centre[2], remaining]);
    for (const { id, remaining, x, z } of pendingFormations.values()) formations.push([id, x, z, remaining]);
    // Ordered by id: a reloaded and a continuous island save the same ledger.
    formations.sort((a, b) => b[0] - a[0]);
    return { formations, nextId, props: [...propRemaining].sort((a, b) => a[0] - b[0]), seams: mountain.saveState() };
  };
  const exhausted = () => exhaustedCache ??= [
    ...[...propRemaining].filter(([id, amount]) => amount === 0 && world.props.types[id] === PROP_REMOVED).map(([id]) => id),
    ...[...deposits].filter(([, source]) => source.remaining === 0).map(([id]) => id),
    ...[...pendingFormations.values()].filter(source => source.remaining === 0).map(source => source.id),
    ...mountain.saveState().filter(([, amount]) => amount === 0).map(([id]) => id)
  ];
  const spot = (id: number): SettlementPoint | null => {
    if (id >= 0) return id < world.props.count ? { x: world.props.x[id]!, z: world.props.z[id]! } : null;
    if (id <= FORMATION_ID_FLOOR) return mountain.spot(id);
    const source = deposits.get(id);
    if (source) return { x: source.rock.centre[0], z: source.rock.centre[2] };
    const pending = [...pendingFormations.values()].find(source => source.id === id);
    return pending ? { x: pending.x, z: pending.z } : null;
  };
  const canRestore = (id: number) => {
    const point = spot(id);
    if (!point) return false;
    if (id >= 0) return canConsume({ ...point, id, kind: "stone" }, true);
    const blocking = world.blocking[Math.floor(point.z) * world.cellsX + Math.floor(point.x)];
    if (blocking === BLOCKING.prop || blocking === BLOCKING.water) return false;
    if (id <= FORMATION_ID_FLOOR) return mountain.canRestore(id);
    let source = deposits.get(id);
    if (!source) {
      const rock = getKnownRocks(world).find(rock => formationKey(rock.centre[0], rock.centre[2]) === formationKey(point.x, point.z));
      if (!rock) return false;
      register(rock); source = deposits.get(id);
    }
    return !!source && formationTargets(source.rock, id, point, Infinity, true).length > 0;
  };
  const refill = (id: number) => {
    exhaustedCache = undefined;
    if (id >= 0) refillProp(id);
    else if (id <= FORMATION_ID_FLOOR) mountain.refill(id);
    else {
      const deposit = deposits.get(id);
      if (deposit) deposit.remaining = freshFormationAmount(deposit.rock);
    }
  };
  return { canConsume, canRestore, consume, exhausted, freshAmount, refill, refillProp, remaining, saveState, spot, targets };
};
