import { DMath } from "../math/deterministic-math";
import { isNavigationClear } from "./settlement-navigation";
import { updatePersonTraffic } from "./settlement-person-index";
import { actorSeparation, FOOT_SEPARATION_BOUND } from "./settlement-traffic";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/** Below this many waiting people the plain pairwise scan is cheaper than building the grid. */
const IDLE_GRID_MIN_PEOPLE = 24;
/** Neighbour reach: above every waiting pair's separation, so a pair out of reach is never pushed. */
const IDLE_REACH = FOOT_SEPARATION_BOUND + 1e-3;
const CELL_STRIDE = 65_536;

/** Visible idle people with no committed task drift apart instead of stacking at a doorway. */
const isWaitingIdle = (actor: SettlementActor) =>
  actor.visible && actor.action === "idle" && !actor.mounted && !actor.handcart &&
  actor.job !== "Soldier" && actor.job !== "Mount" && !actor.target && !actor.queueTarget &&
  !actor.delivery && !actor.stockContact && actor.pathIndex >= actor.path.length;

/** One pairwise push (unchanged rule); reports which of the two moved. */
const separatePair = (context: SettlementContext, a: SettlementActor, b: SettlementActor) => {
  const separation = actorSeparation(a, b);
  let dx = b.x - a.x, dz = b.z - a.z;
  let distance = DMath.hypot(dx, dz);
  if (distance >= separation) return { aMoved: false, bMoved: false };
  if (distance < 1e-5) {
    const angle = ((a.uid * 2654435761 + b.uid * 40503) >>> 0) / 4294967296 * Math.PI * 2;
    dx = DMath.cos(angle); dz = DMath.sin(angle); distance = 1;
  }
  const push = (separation - distance) / 2 + .002;
  const ax = a.x - dx / distance * push, az = a.z - dz / distance * push;
  const bx = b.x + dx / distance * push, bz = b.z + dz / distance * push;
  const aMoved = isNavigationClear(context, { x: ax, z: az });
  if (aMoved) {
    a.x = ax; a.z = az; updatePersonTraffic(context, a);
  }
  const bMoved = isNavigationClear(context, { x: bx, z: bz });
  if (bMoved) {
    b.x = bx; b.z = bz; updatePersonTraffic(context, b);
  }
  return { aMoved, bMoved };
};

const separatePairwise = (context: SettlementContext, actors: SettlementActor[]) => {
  for (let first = 0; first < actors.length; first++)
    for (let second = first + 1; second < actors.length; second++) separatePair(context, actors[first]!, actors[second]!);
};

const cellOf = (value: number) => Math.floor(value / IDLE_REACH);

/** Waiting people bucketed by `IDLE_REACH` cells; buckets hold indices into the waiting list. */
const createIdleGrid = (actors: SettlementActor[]) => {
  const buckets = new Map<number, number[]>();
  const keys: number[] = [];
  const add = (index: number) => {
    const actor = actors[index]!;
    const key = cellOf(actor.z) * CELL_STRIDE + cellOf(actor.x);
    keys[index] = key;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index); else buckets.set(key, [index]);
  };
  actors.forEach((_actor, index) => add(index));
  return {
    /** Indices above `after` within reach of `actor`, ascending (the pairwise order). */
    after: (actor: SettlementActor, after: number) => {
      const found: number[] = [];
      for (let z = cellOf(actor.z - IDLE_REACH); z <= cellOf(actor.z + IDLE_REACH); z++)
        for (let x = cellOf(actor.x - IDLE_REACH); x <= cellOf(actor.x + IDLE_REACH); x++)
          for (const index of buckets.get(z * CELL_STRIDE + x) ?? []) if (index > after) found.push(index);
      return found.sort((a, b) => a - b);
    },
    move: (index: number) => {
      const bucket = buckets.get(keys[index]!)!;
      bucket.splice(bucket.indexOf(index), 1);
      add(index);
    }
  };
};

/**
 * A10: the same pairwise pass through a neighbour grid. A pair farther apart than `IDLE_REACH` is a
 * no-op in the pairwise loop, so only pairs in reach are visited, in the same (first, second) order.
 * Only the two people of a push move; when the first one moves its remaining partners are gathered
 * again from its new place, so every later partner it comes within reach of is still visited.
 */
const separateThroughGrid = (context: SettlementContext, actors: SettlementActor[]) => {
  const grid = createIdleGrid(actors);
  for (let first = 0; first < actors.length; first++) {
    const a = actors[first]!;
    let partners = grid.after(a, first);
    for (let cursor = 0; cursor < partners.length; cursor++) {
      const second = partners[cursor]!;
      const { aMoved, bMoved } = separatePair(context, a, actors[second]!);
      if (bMoved) grid.move(second);
      if (!aMoved) continue;
      grid.move(first);
      partners = grid.after(a, second);
      cursor = -1;
    }
  }
};

const hasFinitePositions = (actors: SettlementActor[]) =>
  actors.every(actor => Number.isFinite(actor.x) && Number.isFinite(actor.z));

export const separateIdlePeople = (context: SettlementContext) => {
  const actors = context.actors.filter(isWaitingIdle);
  if (actors.length < IDLE_GRID_MIN_PEOPLE || !hasFinitePositions(actors)) separatePairwise(context, actors);
  else separateThroughGrid(context, actors);
};

/** Test hook: the pairwise pass the grid must reproduce exactly. */
export const separateIdlePeoplePairwise = (context: SettlementContext) =>
  separatePairwise(context, context.actors.filter(isWaitingIdle));
