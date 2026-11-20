import type { TileRect } from "../world/navigation-change-log";
import { touchCorridorEdges } from "./building-navigation-corridor";
import { buildFlowField, flowFieldRegion, type MilitaryFlowField } from "./military-flow-field";
import { isCellOpen } from "./military-long-routes";
import { touchRiderTiles } from "./military-rider-tiles";
import {
  NAVIGATION_HALO,
  navigationInvalidation,
  navigationJournalWork,
  type NavigationReads,
  navigationRevisionNow,
  READ_NONE,
  READ_TRUE,
  readsCell,
  shouldVerifyNavigationReuse,
  staleNavigationBlocks,
  withNavigationSession
} from "./navigation-change-journal";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

type FlowBounds = Pick<MilitaryFlowField, "height" | "minX" | "minZ" | "width">;

/**
 * A03 flow-field reuse and sharing. At a route revision boundary a field is kept when every input it
 * read answers as recorded: inputs away from every changed block are unchanged by the halo proof,
 * inputs near one are read again (A03b). Groups with the same target, ground and box share one field
 * (identical input, identical field). A kept or shared field stands in for the rebuild that would
 * have run now, so the rider tiles and corridor edges that rebuild would read count as read in this
 * epoch.
 */

/** Fields kept for sharing (a group keeps its own field regardless; this only bounds memory). */
const SHARED_FIELD_LIMIT = 16;
/**
 * Tiles round a changed block whose reads are repeated: a cell reads within `NAVIGATION_HALO`, and a
 * corridor edge's box reaches one tile further than its two end tiles (a diagonal edge).
 */
const REREAD_MARGIN = NAVIGATION_HALO + 1;
const sharedFields = createTransientMap<Map<string, MilitaryFlowField>>();
const sharedFieldsOf = (context: SettlementContext) => {
  let fields = sharedFields.get(context);
  if (!fields) {
    fields = new Map();
    sharedFields.set(context, fields);
  }
  return fields;
};
const fieldKey = (goal: SettlementPoint, mounted: boolean, bounds: FlowBounds) =>
  `${mounted ? 1 : 0}:${goal.x}:${goal.z}:${bounds.minX}:${bounds.minZ}:${bounds.width}:${bounds.height}`;

const sameArrays = (first: ArrayLike<number>, second: ArrayLike<number>) => {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) if (first[index] !== second[index]) return false;
  return true;
};
const verifyKeptField = (context: SettlementContext, field: MilitaryFlowField) => {
  if (!shouldVerifyNavigationReuse()) return;
  const { height, minX, minZ, width } = field;
  const rebuilt = buildFlowField(context, field.goal, field.mounted, { height, minX, minZ, width });
  if (!sameArrays(rebuilt.cost, field.cost) || !sameArrays(rebuilt.next, field.next))
    throw new Error(`Stale flow field to ${field.goal.x}, ${field.goal.z}: kept across a navigation change`);
};

/** Box cells within `REREAD_MARGIN` of a changed block (1), the rest 0. */
const dirtyCells = ({ box }: NavigationReads, changed: readonly TileRect[]) => {
  const dirty = new Uint8Array(box.width * box.height);
  for (const block of changed) {
    const fromX = Math.max(0, block.minX - REREAD_MARGIN - box.minX);
    const toX = Math.min(box.width - 1, block.maxX + REREAD_MARGIN - box.minX);
    const fromZ = Math.max(0, block.minZ - REREAD_MARGIN - box.minZ);
    const toZ = Math.min(box.height - 1, block.maxZ + REREAD_MARGIN - box.minZ);
    for (let z = fromZ; z <= toZ; z++) dirty.fill(1, z * box.width + fromX, z * box.width + toX + 1);
  }
  return dirty;
};
/** True while every open-cell read and walking cost of the dirty cells is as the build recorded it. */
const sameDirtyCells = (context: SettlementContext, reads: NavigationReads, dirty: Uint8Array) => {
  const { box, open, walkCost } = reads, world = context.options.world;
  for (let cell = 0; cell < dirty.length; cell++) {
    if (!dirty[cell]) continue;
    const x = box.minX + cell % box.width, z = box.minZ + Math.floor(cell / box.width);
    if (walkCost[cell] !== world.walkCost[z * world.cellsX + x]) return false;
    const read = open[cell]!;
    if (read !== READ_NONE && isCellOpen(context, x, z) !== (read === READ_TRUE)) return false;
  }
  return true;
};
/**
 * True when `field` equals a rebuild now (the reads near a changed block answer as recorded, the
 * others are unchanged); it is then confirmed for `revision`.
 */
const confirmField = (context: SettlementContext, field: MilitaryFlowField, revision: string) =>
  withNavigationSession(context, () => {
    const { reads } = field;
    const changed = staleNavigationBlocks(context, flowFieldRegion(context, field), field.stamp);
    if (!changed) return false;
    const dirty = changed.length ? dirtyCells(reads, changed) : null;
    const isDirtyCell = dirty && ((cell: number) => dirty[cell] === 1);
    const isDirtyTile = dirty && ((tile: number) => dirty[readsCell(reads, tile)] === 1);
    if (dirty && !sameDirtyCells(context, reads, dirty)) return false;
    if (field.riderGate && !touchRiderTiles(context, reads, isDirtyCell)) return false;
    if (reads.edges.size && !touchCorridorEdges(context, reads.edges, field.stamp, isDirtyTile)) return false;
    verifyKeptField(context, field);
    if (dirty) navigationJournalWork.fieldRereads++;
    field.revision = revision;
    field.stamp = navigationRevisionNow(context);
    return true;
  });

const shareField = (context: SettlementContext, key: string, field: MilitaryFlowField) => {
  const fields = sharedFieldsOf(context);
  fields.delete(key);
  fields.set(key, field);
  if (fields.size > SHARED_FIELD_LIMIT) fields.delete(fields.keys().next().value!);
};

/**
 * The flow field a group walks after a route revision boundary: its own field or a shared one
 * when still fresh, otherwise a new build (always a new build in the rollback mode).
 */
export const flowFieldAt = (context: SettlementContext, known: MilitaryFlowField | undefined,
  goal: SettlementPoint, mounted: boolean, bounds: FlowBounds, revision: string) => {
  if (navigationInvalidation().mode === "global") {
    navigationJournalWork.fieldBuilds++;
    return buildFlowField(context, goal, mounted, bounds);
  }
  if (known && confirmField(context, known, revision)) {
    navigationJournalWork.fieldKeeps++;
    return known;
  }
  const key = fieldKey(goal, mounted, bounds), shared = sharedFieldsOf(context).get(key);
  if (shared && shared !== known && confirmField(context, shared, revision)) {
    navigationJournalWork.fieldShares++;
    return shared;
  }
  navigationJournalWork.fieldBuilds++;
  const field = buildFlowField(context, goal, mounted, bounds);
  shareField(context, key, field);
  return field;
};
