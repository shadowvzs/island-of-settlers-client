import { explainNavigationChange } from "./navigation-change-journal";
import { recordOccupancyStep } from "./settlement-occupancy-changes";
import type { SettlementContext } from "./settlement-types";

const FIELD_PREFIX = "field:";

/** Islands reloading their own snapshot in place (D3): the restored occupancy is the one they already had. */
const unchangedNavigation = new WeakSet<SettlementContext>();

/**
 * Any change that can make `isOccupied`, and therefore road walkability, answer differently. `cells`
 * names every cell whose `isOccupied` answer it can change (null: unknown, the road cache clears).
 */
export const bumpNavigationRevision = (context: SettlementContext, cells: readonly number[] | null = null) => {
  if (unchangedNavigation.has(context)) return;
  const from = context.navigationRevision ?? 0;
  context.navigationRevision = from + 1;
  recordOccupancyStep(context, from, from + 1, cells);
};

/**
 * A field site or field reservation changed: only road traffic and work targets read fields, never the
 * military corridor and flow geometry, so the change journal keeps those caches (A03).
 */
export const bumpFieldNavigationRevision = (context: SettlementContext, cells: readonly number[] | null = null) =>
  explainNavigationChange(context, null, () => bumpNavigationRevision(context, cells));

/**
 * Runs `restore` without navigation changes: an in-place reload writes back the very occupancy, fields and
 * reservations it saved, so every navigation-revision cache stays valid and need not be rebuilt.
 */
export const withUnchangedNavigation = <Result>(context: SettlementContext, restore: () => Result) => {
  unchangedNavigation.add(context);
  try {
    return restore();
  } finally {
    unchangedNavigation.delete(context);
  }
};

/**
 * Work-target reservations ("kind:id"). Reserved field cells block roads, so they are mirrored
 * into a cell mask (no string building on the walkability path) and bump the navigation revision.
 */
class SettlementReservations extends Set<string> {
  readonly fieldCells: Uint8Array;
  private readonly onFieldChange: (cells: readonly number[] | null) => void;

  constructor(cellCount: number, onFieldChange: (cells: readonly number[] | null) => void,
    values: Iterable<string> = []) {
    super();
    this.fieldCells = new Uint8Array(cellCount);
    this.onFieldChange = onFieldChange;
    for (const value of values) this.add(value);
  }

  override add(value: string) {
    if (!this.has(value)) this.markField(value, 1);
    return super.add(value);
  }

  override delete(value: string) {
    if (this.has(value)) this.markField(value, 0);
    return super.delete(value);
  }

  override clear() {
    if (this.fieldCells.includes(1)) this.onFieldChange(null);
    this.fieldCells.fill(0);
    super.clear();
  }

  private markField(value: string, reserved: 0 | 1) {
    if (!value.startsWith(FIELD_PREFIX)) return;
    const cell = Number(value.slice(FIELD_PREFIX.length));
    if (!Number.isInteger(cell) || cell < 0 || cell >= this.fieldCells.length) return;
    this.fieldCells[cell] = reserved;
    this.onFieldChange([cell]);
  }
}

export const createSettlementReservations = (context: SettlementContext, values?: Iterable<string>) => {
  const { cellsX, cellsZ } = context.options.world;
  return new SettlementReservations(cellsX * cellsZ, cells => bumpFieldNavigationRevision(context, cells), values);
};

/** True when the cell holds a field reservation; plain test Sets fall back to the string key. */
export const isFieldCellReserved = (context: SettlementContext, cell: number) => {
  const { reservations } = context;
  if (reservations instanceof SettlementReservations) return reservations.fieldCells[cell] === 1;
  return reservations.has(`${FIELD_PREFIX}${cell}`);
};
