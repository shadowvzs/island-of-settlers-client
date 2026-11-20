import type { OccupancyChanges } from "./road-types";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementContext } from "./settlement-types";

/**
 * A04b: which cells a navigation (occupancy) revision step changed, so the road route cache rechecks
 * only the memoized edges near them instead of forgetting every route. A step without cells (most
 * bumps: placement, demolition, decorations, loads) and a revision move outside `bumpNavigationRevision`
 * leave the chain incomplete, and the cache then clears exactly as before.
 */

/** Revision steps kept per island; an older mark falls back to a full invalidation. */
const OCCUPANCY_LOG_LIMIT = 256;

interface OccupancyStep {
  cells: readonly number[] | null;
  from: number;
  to: number;
}
interface OccupancyLog {
  dropped: number;
  steps: OccupancyStep[];
}

const logs = createTransientMap<OccupancyLog>();
const logOf = (context: SettlementContext) => {
  let log = logs.get(context);
  if (log) return log;
  log = { dropped: 0, steps: [] };
  logs.set(context, log);
  return log;
};

/** One navigation revision step `from` → `to`; `cells` names every cell whose occupancy it changed. */
export const recordOccupancyStep = (
  context: SettlementContext, from: number, to: number, cells: readonly number[] | null
) => {
  const log = logOf(context);
  log.steps.push({ cells, from, to });
  if (log.steps.length <= OCCUPANCY_LOG_LIMIT) return;
  const drop = log.steps.length - OCCUPANCY_LOG_LIMIT / 2;
  log.steps.splice(0, drop);
  log.dropped += drop;
};

interface OccupancyMark {
  decorations: number;
  fieldCycles: unknown;
  log: OccupancyLog;
  /** Copy of `context.occupied`: cells written without a cell-explained step are found by comparison. */
  occupied: Uint8Array;
  position: number;
  reservations: unknown;
  revision: number;
}

const decorationRevision = (context: SettlementContext) => context.roadDecorations?.revision() ?? 0;
const navigationRevision = (context: SettlementContext) => context.navigationRevision ?? 0;

/** The cells of the logged steps after `mark`, or null when a step is unexplained or missing. */
const loggedCells = (context: SettlementContext, mark: OccupancyMark, cells: number[]) => {
  const log = logOf(context), start = mark.position - log.dropped;
  if (mark.log !== log || start < 0) return false;
  let revision = mark.revision;
  for (let index = start; index < log.steps.length; index++) {
    const step = log.steps[index]!;
    if (!step.cells || step.from !== revision) return false;
    revision = step.to;
    for (const cell of step.cells) cells.push(cell);
  }
  return revision === navigationRevision(context);
};

/** Adds every cell whose `occupied` value differs from the marked copy. */
const occupiedCells = (occupied: Uint8Array, marked: Uint8Array, cells: number[]) => {
  if (occupied.length !== marked.length) return false;
  for (let cell = 0; cell < occupied.length; cell++) if (occupied[cell] !== marked[cell]) cells.push(cell);
  return true;
};

const sameInputs = (context: SettlementContext, mark: OccupancyMark) =>
  mark.decorations === decorationRevision(context) && mark.fieldCycles === context.fieldCycles &&
  mark.reservations === context.reservations;

/**
 * The settlement's `isOccupied` change source for the road network. Field reservations and field site
 * changes name their cell; `occupied` is compared with a copy; road decorations, a replaced field or
 * reservation store, or any unexplained revision step make the answer unknown (null).
 */
export const createOccupancyChanges = (context: SettlementContext): OccupancyChanges => {
  let mark: OccupancyMark | undefined;
  const changedCells = () => {
    if (!mark || !sameInputs(context, mark)) return null;
    const cells: number[] = [];
    if (!loggedCells(context, mark, cells) || !occupiedCells(context.occupied, mark.occupied, cells)) return null;
    return cells;
  };
  const copyOccupied = (previous: Uint8Array | undefined) => {
    if (previous?.length !== context.occupied.length) return context.occupied.slice();
    previous.set(context.occupied);
    return previous;
  };
  const markNow = () => {
    const log = logOf(context);
    mark = { decorations: decorationRevision(context), fieldCycles: context.fieldCycles, log,
      occupied: copyOccupied(mark?.occupied), position: log.dropped + log.steps.length,
      reservations: context.reservations, revision: navigationRevision(context) };
  };
  return { changedCells, mark: markNow };
};
