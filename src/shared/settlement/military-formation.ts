import { DMath } from "../math/deterministic-math";
import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import type { SettlementPoint } from "./settlement-types";

/** Spare rows tried when some places of the block fall on water, rock or buildings. */
const SPARE_ROWS = 2;
/** The slowest share of the group pace: a soldier with only a step to take still walks. */
const MINIMUM_PACE_SHARE = .4;
/** A soldier this close to its place that gains no ground for this long settles where it stands. */
const SETTLE_RADIUS = 4;
/** A rider settles further out: a standing block leaves a horse no gap to its place in the middle of it. */
export const MOUNTED_SETTLE_RADIUS = 8;
const SETTLE_SECONDS = 2;
/** Ground (tiles) that counts as progress towards the place. */
const SETTLE_PROGRESS = .1;
/** Further away, a soldier that has not left a spot this wide (tiles) for this long plans afresh. */
const STUCK_DISTANCE = 1;
const REPLAN_SECONDS = 3;

export interface FormationSlot extends SettlementPoint { row: number; side: number }

const along = (point: SettlementPoint, axis: SettlementPoint) => point.x * axis.x + point.z * axis.z;

/** Unit vector from the group's centre towards the destination (south when already there). */
export const marchDirection = (starts: readonly SettlementPoint[], destination: SettlementPoint) => {
  const centre = starts.reduce((sum, point) => ({ x: sum.x + point.x / starts.length,
    z: sum.z + point.z / starts.length }), { x: 0, z: 0 });
  const dx = destination.x - centre.x, dz = destination.z - centre.z;
  const length = DMath.hypot(dx, dz);
  return length < 1e-3 ? { x: 0, z: 1 } : { x: dx / length, z: dz / length };
};

/** Columns of a square-ish block of `count` places. */
const squareColumns = (count: number) => Math.max(1, Math.ceil(Math.sqrt(count)));

/** Block places, front row (furthest along the march) first, each row across the march. */
const blockSlots = (count: number, destination: SettlementPoint, direction: SettlementPoint,
  spacing: number, isClear: (point: SettlementPoint) => boolean, columns = squareColumns(count)) => {
  const rows = Math.ceil(count / columns);
  const across = { x: direction.z, z: -direction.x };
  const slots: FormationSlot[] = [];
  for (let row = 0; row < rows + SPARE_ROWS && slots.length < count; row++) {
    const depth = ((rows - 1) / 2 - row) * spacing;
    for (let column = 0; column < columns && slots.length < count; column++) {
      const side = (column - (columns - 1) / 2) * spacing;
      const slot = { row, side, x: destination.x + direction.x * depth + across.x * side,
        z: destination.z + direction.z * depth + across.z * side };
      if (isClear(slot)) slots.push(slot);
    }
  }
  return slots;
};

/**
 * Which slot each member takes (its index into `slots`, -1: none left): the members furthest
 * along `direction` fill the front row, and each row keeps their order across the march, so no
 * one has to cut through comrades on the way to its place. `slots` come front row first.
 */
const fillRowsInOrder = (starts: readonly SettlementPoint[], slots: readonly FormationSlot[],
  direction: SettlementPoint) => {
  const across = { x: direction.z, z: -direction.x };
  const order = starts.map((_, index) => index)
    .sort((a, b) => along(starts[b]!, direction) - along(starts[a]!, direction) || a - b);
  const assigned = starts.map(() => -1);
  for (let first = 0; first < slots.length && first < order.length;) {
    const row = slots[first]!.row;
    let last = first;
    while (last < slots.length && slots[last]!.row === row) last++;
    const members = order.slice(first, last)
      .sort((a, b) => along(starts[a]!, across) - along(starts[b]!, across) || a - b);
    const places = slots.slice(first, last).map((_, index) => first + index)
      .sort((a, b) => along(slots[a]!, across) - along(slots[b]!, across) || a - b);
    members.forEach((member, index) => { assigned[member] = places[index]!; });
    first = last;
  }
  return assigned;
};

/**
 * Formation places for a group ordered to `destination`, one per start (or null where the block
 * has no room). The block faces the march; the soldiers furthest ahead take the front row and each
 * row keeps its left-to-right order, so no soldier has to cut through comrades that already stand
 * in their places (a mounted rider cannot pass between two horses: that was the reverse jitter).
 */
export const assignFormationSlots = (starts: readonly SettlementPoint[], destination: SettlementPoint,
  spacing: number, isClear: (point: SettlementPoint) => boolean,
  direction = marchDirection(starts, destination), columns?: number): (SettlementPoint | null)[] => {
  if (!starts.length) return [];
  const slots = blockSlots(starts.length, destination, direction, spacing, isClear, columns);
  return fillRowsInOrder(starts, slots, direction).map(slot => {
    if (slot < 0) return null;
    const { x, z } = slots[slot]!;
    return { x, z };
  });
};

/** Places of one troop kind in a mixed group (owner wish 2026-10-13: a tight block, not 2.6 apart). */
export type FormationKind = "foot" | "archer" | "rider";
/** Spacing per kind: shoulder to shoulder foot, archers a little looser, riders a horse apart. */
const KIND_SPACING: Readonly<Record<FormationKind, number>> = { archer: .6, foot: .5, rider: 2.2 };
/** Gap between the foot block and the archers behind it or the cavalry wings beside it. */
const BLOCK_GAP = .8;
/** A wing's riders keep this much more room from the foot block (a horse is wide at the flank). */
const WING_CLEARANCE = 1;
/** Archers stand in at most this many rows behind the infantry (a line along the front). */
const ARCHER_ROWS = 2;
/** Width across the march and depth along it of a block of `count` places (square-ish by default). */
const blockSize = (count: number, spacing: number, columns = squareColumns(count)) => {
  const rows = Math.ceil(count / columns);
  return { depth: Math.max(0, rows - 1) * spacing, width: Math.max(0, columns - 1) * spacing };
};
const shifted = (point: SettlementPoint, axis: SettlementPoint, distance: number) =>
  ({ x: point.x + axis.x * distance, z: point.z + axis.z * distance });

/**
 * Formation of a mixed group: the foot melee in a tight block on the destination, archers just
 * behind it, riders in two wings on its flanks (a group of riders only forms one block). Each kind
 * keeps its own spacing, so a mixed group no longer spreads out to the riders' 2.6 tiles.
 * `isClear` checks a place for that kind of soldier.
 */
export const assignGroupFormation = (starts: readonly SettlementPoint[], kinds: readonly FormationKind[],
  destination: SettlementPoint, isClear: (point: SettlementPoint, kind: FormationKind) => boolean) => {
  const assigned: (SettlementPoint | null)[] = starts.map(() => null);
  if (!starts.length) return assigned;
  const direction = marchDirection(starts, destination), across = { x: direction.z, z: -direction.x };
  const members = (kind: FormationKind) => kinds.flatMap((entry, index) => entry === kind ? [index] : []);
  const foot = members("foot"), archers = members("archer"), riders = members("rider");
  const place = (indices: readonly number[], kind: FormationKind, centre: SettlementPoint, columns?: number) => {
    const slots = assignFormationSlots(indices.map(index => starts[index]!), centre, KIND_SPACING[kind],
      point => isClear(point, kind), direction, columns);
    indices.forEach((member, index) => { assigned[member] = slots[index] ?? null; });
  };
  const footSize = blockSize(foot.length, KIND_SPACING.foot);
  place(foot, "foot", destination);
  // Archers spread along the front behind the infantry: a line at least as wide as the foot block.
  const lineColumns = Math.max(Math.ceil(archers.length / ARCHER_ROWS),
    Math.ceil(footSize.width / KIND_SPACING.archer) + 1);
  const archerColumns = foot.length && archers.length ? Math.min(archers.length, lineColumns) : undefined;
  const archerSize = blockSize(archers.length, KIND_SPACING.archer, archerColumns);
  const behind = foot.length ? footSize.depth / 2 + BLOCK_GAP + archerSize.depth / 2 : 0;
  place(archers, "archer", shifted(destination, direction, -behind), archerColumns);
  if (!foot.length && !archers.length) { place(riders, "rider", destination); return assigned; }
  // Two wings; the left one takes the riders furthest left now, so no rider crosses the block.
  const ordered = [...riders].sort((a, b) => along(starts[a]!, across) - along(starts[b]!, across) || a - b);
  const left = ordered.slice(0, Math.ceil(ordered.length / 2)), right = ordered.slice(left.length);
  const blockWidth = Math.max(footSize.width, archerSize.width);
  for (const [wing, side] of [[left, -1], [right, 1]] as const) {
    const wingWidth = blockSize(wing.length, KIND_SPACING.rider).width;
    const reach = blockWidth / 2 + BLOCK_GAP + WING_CLEARANCE + wingWidth / 2;
    if (wing.length) place(wing, "rider", shifted(destination, across, side * reach));
  }
  return assigned;
};

/**
 * Each member's pace for a group march: the slowest member's speed, scaled by the share of the
 * longest march it has to make, so the whole block arrives together. Moving as one block (rather
 * than the nearest soldiers taking their places first) keeps every soldier clear of the others.
 */
export const groupMarchPaces = (members: readonly { goal: SettlementPoint; speed: number;
  start: SettlementPoint }[]) => {
  const pace = Math.min(...members.map(member => member.speed));
  const distances = members.map(({ goal, start }) => DMath.hypot(goal.x - start.x, goal.z - start.z));
  const longest = Math.max(...distances);
  if (longest < 1e-6) return members.map(() => pace);
  return distances.map(distance => pace * Math.max(MINIMUM_PACE_SHARE, distance / longest));
};

/** `closest`/`stalled`: ground gained towards the place; `spot`/`still`: whether it moves at all. */
interface MarchWatch { closest: number; spot: SettlementPoint; stalled: number; still: number }
export type MarchSettlingSave = SavedEntries<MarchWatch>;

/**
 * Progress of an ordered march. Near a crowded place, a soldier whose way in is held by comrades
 * already standing in the block (two horses abreast leave no gap for a third) stops close by instead
 * of stepping aside and back for ever; stuck on one spot further away (a detour round a lake still
 * moves), it plans its way afresh.
 */
export const createMarchSettling = () => {
  const watches = new Map<number, MarchWatch>();
  return {
    /** "settle" near a crowded place, "replan" when stuck further away, else "march" on. */
    progress: (uid: number, position: SettlementPoint, destination: SettlementPoint, dt: number,
      radius = SETTLE_RADIUS) => {
      const distance = DMath.hypot(destination.x - position.x, destination.z - position.z);
      const watch = watches.get(uid);
      if (!watch) {
        watches.set(uid, { closest: distance, spot: { x: position.x, z: position.z }, stalled: 0, still: 0 });
        return "march";
      }
      if (distance < watch.closest - SETTLE_PROGRESS) { watch.closest = distance; watch.stalled = 0; }
      else watch.stalled += dt;
      if (DMath.hypot(position.x - watch.spot.x, position.z - watch.spot.z) > STUCK_DISTANCE) {
        watch.spot = { x: position.x, z: position.z }; watch.still = 0;
      } else watch.still += dt;
      if (distance <= radius) return watch.stalled >= SETTLE_SECONDS ? "settle" : "march";
      if (watch.still < REPLAN_SECONDS) return "march";
      watch.still = 0;
      return "replan";
    },
    forget: (uid: number) => watches.delete(uid),
    clear: () => watches.clear(),
    save: (): MarchSettlingSave => saveEntries(watches),
    restore: (saved: MarchSettlingSave | undefined) =>
      restoreEntries(watches, saved)
  };
};

interface ArrivingBlock { destination: SettlementPoint; uids: readonly number[] }
/** Each block once, with the members still waiting for it (`uids`: the whole group, as joined). */
export type ArrivingBlocksSave = (ArrivingBlock & { waiting: number[] })[];

/**
 * A long march regroups on its approach. Across the island a group drifts apart (detours, traffic,
 * legs planned a few per tick), so places assigned at the order would make late soldiers push
 * through comrades already standing in theirs. When the first member comes within the approach
 * radius, the whole group is handed back to be given places (and paces) again from where its
 * members actually are.
 */
export const createArrivingBlocks = () => {
  const members = new Map<number, ArrivingBlock>();
  return {
    join: (uids: readonly number[], destination: SettlementPoint) => {
      const block = { destination: { ...destination }, uids: [...uids] };
      for (const uid of uids) members.set(uid, block);
    },
    /** The group to regroup now, once this member is within `radius` of its destination (else null). */
    approach: (uid: number, from: SettlementPoint, radius: number) => {
      const block = members.get(uid);
      if (!block || DMath.hypot(block.destination.x - from.x, block.destination.z - from.z) > radius) return null;
      for (const member of block.uids) if (members.get(member) === block) members.delete(member);
      return block;
    },
    leave: (uid: number) => members.delete(uid),
    clear: () => members.clear(),
    save: (): ArrivingBlocksSave => {
      const blocks = new Map<ArrivingBlock, number[]>();
      for (const [uid, block] of members) {
        const waiting = blocks.get(block);
        if (waiting) waiting.push(uid); else blocks.set(block, [uid]);
      }
      return [...blocks].map(([block, waiting]) => structuredClone({ ...block, waiting }));
    },
    /** Members are only looked up (never iterated); the waiting members of a block share it again. */
    restore: (saved: ArrivingBlocksSave | undefined) => {
      members.clear();
      for (const { destination, uids, waiting } of saved ?? []) {
        const block = { destination: { ...destination }, uids: [...uids] };
        for (const uid of waiting) members.set(uid, block);
      }
    }
  };
};
