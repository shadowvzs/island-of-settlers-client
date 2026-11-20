import {
  SCOUT_CLEAR_CHECKS, SCOUT_GOALS, SCOUT_PLAN_TICKS, SCOUT_REACH, SECTOR_TILES
} from "../../balance/commander-director";
import type { SettlementPoint } from "../settlement-types";
import { distance } from "./director-forces";

/**
 * Scout plans (A14 plan §5.1, §6, lane A14-4b): per computer faction, up to `SCOUT_GOALS` places a scouting trip
 * visits: the enemy's start-known places (owner Q3: the landing harbour / key building) whose sector is stale,
 * then the stale sectors on the way there. A plan stays fixed while its trip runs (the director indexes its
 * goals by the visits made) and is replaced once every goal was seen since it was made, or when it is old.
 */
export interface ScoutPlan { tick: number; goals: SettlementPoint[] }

/** Saved: [viewer, tick, [x, z][]]. */
export type ScoutPlanEntry = [number, number, [number, number][]];

/** What a plan reads: the faction's sector staleness, its level's scout age and the ground. */
export interface ScoutPlanReads {
  /** A sector unseen for longer than this (ticks) is stale (the commander profile's `scoutAgeTicks`). */
  scoutAgeTicks: number;
  /** The effective last tick the faction saw the sector holding `point` (−1: never). */
  lastSeen: (point: SettlementPoint) => number;
  /** The sector index of a point, and every sector's centre. */
  sectorOf: (point: SettlementPoint) => number;
  centreOf: (sector: number) => SettlementPoint;
  sectorsX: number;
  sectorsZ: number;
  isClear: (point: SettlementPoint) => boolean;
}

const isStale = (lastSeen: number, now: number, scoutAgeTicks: number) =>
  lastSeen < 0 || now - lastSeen > scoutAgeTicks;
const byPoint = (a: SettlementPoint, b: SettlementPoint) => a.x - b.x || a.z - b.z;

/** Stale sector centres within `SCOUT_REACH` of `from`, cheapest detour towards `towards` first (index ties). */
const staleSectors = (reads: ScoutPlanReads, from: SettlementPoint, towards: SettlementPoint, now: number) => {
  const reach = Math.ceil(SCOUT_REACH / SECTOR_TILES), origin = reads.sectorOf(from);
  const column = origin % reads.sectorsX, row = (origin - column) / reads.sectorsX;
  const scored: { centre: SettlementPoint; score: number; sector: number }[] = [];
  for (let sz = Math.max(0, row - reach); sz <= Math.min(reads.sectorsZ - 1, row + reach); sz++) {
    for (let sx = Math.max(0, column - reach); sx <= Math.min(reads.sectorsX - 1, column + reach); sx++) {
      const sector = sz * reads.sectorsX + sx, centre = reads.centreOf(sector);
      if (distance(centre, from) > SCOUT_REACH || !isStale(reads.lastSeen(centre), now, reads.scoutAgeTicks))
        continue;
      scored.push({ centre, score: distance(from, centre) + distance(centre, towards), sector });
    }
  }
  return scored.sort((a, b) => a.score - b.score || a.sector - b.sector);
};

/**
 * A new plan from `from`: the stale start-known places first, then stale clear sector centres on the way to
 * the nearest of them (≤ `SCOUT_CLEAR_CHECKS` ground checks), never two goals in one sector.
 */
export const planScoutTrip = (
  reads: ScoutPlanReads, from: SettlementPoint, starts: readonly SettlementPoint[], now: number
): SettlementPoint[] => {
  const goals: SettlementPoint[] = [], used = new Set<number>();
  const take = (point: SettlementPoint) => {
    goals.push({ x: point.x, z: point.z });
    used.add(reads.sectorOf(point));
  };
  const known = [...starts].sort((a, b) => distance(a, from) - distance(b, from) || byPoint(a, b));
  for (const start of known)
    if (goals.length < SCOUT_GOALS && !used.has(reads.sectorOf(start)) &&
      isStale(reads.lastSeen(start), now, reads.scoutAgeTicks)) take(start);
  let checks = 0;
  for (const { centre, sector } of staleSectors(reads, from, known[0] ?? from, now)) {
    if (goals.length >= SCOUT_GOALS || checks >= SCOUT_CLEAR_CHECKS) break;
    if (used.has(sector)) continue;
    checks++;
    if (reads.isClear(centre)) take(centre);
  }
  return goals;
};

/** The goals in visiting order from `from`: always the nearest unvisited next (ties by position). */
export const scoutRoute = (goals: readonly SettlementPoint[], from: SettlementPoint) => {
  const left = [...goals], route: SettlementPoint[] = [];
  let at = from;
  while (left.length) {
    let best = 0;
    for (let index = 1; index < left.length; index++) {
      const span = distance(left[index]!, at) - distance(left[best]!, at);
      if (span < 0 || (span === 0 && byPoint(left[index]!, left[best]!) < 0)) best = index;
    }
    at = left.splice(best, 1)[0]!;
    route.push(at);
  }
  return route;
};

/** Whether `plan` still guides a trip at `now`: young enough and with a goal not seen since it was made. */
export const planHolds = (plan: ScoutPlan, now: number, lastSeen: (point: SettlementPoint) => number) =>
  now - plan.tick <= SCOUT_PLAN_TICKS && plan.goals.some(goal => lastSeen(goal) < plan.tick);

const isPair = (value: unknown) => Array.isArray(value) && value.length === 2 &&
  value.every(item => typeof item === "number" && Number.isFinite(item));

/** Null when the saved plans are well formed: ascending viewers, 1-`SCOUT_GOALS` finite goals each. */
export const scoutPlansSaveError = (entries: unknown) => {
  const valid = (entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 3) return false;
    const [viewer, tick, goals] = entry as unknown[];
    return Number.isSafeInteger(viewer) && (viewer as number) > 0 && Number.isSafeInteger(tick) &&
      (tick as number) >= 0 && Array.isArray(goals) && goals.length > 0 && goals.length <= SCOUT_GOALS &&
      goals.every(isPair);
  };
  if (!Array.isArray(entries) || !entries.every(valid)) return "Invalid scout plans";
  for (let index = 1; index < entries.length; index++)
    if ((entries[index] as ScoutPlanEntry)[0] <= (entries[index - 1] as ScoutPlanEntry)[0]) return "Unordered scout plans";
  return null;
};
