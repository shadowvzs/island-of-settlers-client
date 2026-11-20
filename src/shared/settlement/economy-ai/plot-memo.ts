import { secondsToTicks } from "../../../../../island-of-settlers-shared/src/time/constants";
import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { SettlementContext } from "../settlement-types";
import {
  FINGERPRINT_OFFSET, FINGERPRINT_PRIME, PLOT_MEMO_CAPACITY, PLOT_MEMO_HALO, PLOT_MEMO_HEIGHT_STEPS,
  PLOT_MEMO_OWNED_SHIFT, PLOT_MEMO_SECONDS, PLOT_ROTATIONS
} from "./constants";

/**
 * The planner's exact negative memo (plan §3.5, A07 style): a plot whose real placement check failed is skipped
 * while nothing round it changed. Each record keeps a fingerprint of what the real rules read near the plot
 * (`occupied`, blocking, slope and ground class, heights and the faction's territory, with a halo for the entrance
 * lane and signpost); the record holds while the fingerprint is equal, and at most `PLOT_MEMO_SECONDS` for what no
 * layer shows (crop sites, roads). The fingerprint is recomputed from the live island, so a reload decides alike;
 * records are saved (in ticks). Fixed typed arrays: no allocation per decision.
 */
export interface PlotMemo {
  count: number;
  readonly entries: Int32Array;
  readonly expires: Float64Array;
  readonly fingerprints: Int32Array;
  readonly typeIds: Int32Array;
}

/** A saved memo record. */
export interface PlotMemoRecord {
  entry: number;
  expires: number;
  fingerprint: number;
  typeId: number;
}

export const createPlotMemo = (): PlotMemo => ({
  count: 0, entries: new Int32Array(PLOT_MEMO_CAPACITY), expires: new Float64Array(PLOT_MEMO_CAPACITY),
  fingerprints: new Int32Array(PLOT_MEMO_CAPACITY), typeIds: new Int32Array(PLOT_MEMO_CAPACITY)
});

const mix = (hash: number, value: number) => Math.imul(hash ^ value, FINGERPRINT_PRIME);

/** The fingerprint of the cells and vertices round the turned plot of `entry`. */
const plotFingerprint = (context: SettlementContext, owned: Uint8Array, typeId: number, entry: number) => {
  const { world } = context.options, { cellsX, cellsZ } = world;
  const cell = Math.floor(entry / PLOT_ROTATIONS), [baseWidth, baseDepth] = getBuildingDefinition(typeId).gridFootprint;
  const turned = entry % 2 === 1, left = cell % cellsX, top = Math.floor(cell / cellsX);
  const right = Math.min(cellsX - 1, left + (turned ? baseDepth : baseWidth) - 1 + PLOT_MEMO_HALO);
  const bottom = Math.min(cellsZ - 1, top + (turned ? baseWidth : baseDepth) - 1 + PLOT_MEMO_HALO);
  const minX = Math.max(0, left - PLOT_MEMO_HALO), minZ = Math.max(0, top - PLOT_MEMO_HALO);
  let hash = FINGERPRINT_OFFSET;
  for (let z = minZ; z <= bottom; z++) for (let x = minX; x <= right; x++) {
    const at = z * cellsX + x;
    hash = mix(hash, context.occupied[at]! | owned[at]! << PLOT_MEMO_OWNED_SHIFT);
    hash = mix(mix(hash, world.blocking[at]!), world.slopeClass?.[at] ?? 0);
    hash = mix(hash, world.buildCap?.[at] ?? world.buildClass[at]!);
  }
  for (let z = minZ; z <= bottom + 1; z++) for (let x = minX; x <= right + 1; x++)
    hash = mix(hash, Math.round(world.heights[z * (cellsX + 1) + x]! * PLOT_MEMO_HEIGHT_STEPS));
  return hash | 0;
};

const removeAt = (memo: PlotMemo, index: number) => {
  const last = --memo.count;
  memo.entries[index] = memo.entries[last]!;
  memo.expires[index] = memo.expires[last]!;
  memo.fingerprints[index] = memo.fingerprints[last]!;
  memo.typeIds[index] = memo.typeIds[last]!;
};

/** Forgets the records whose time ran out. */
export const pruneMemo = (memo: PlotMemo, now: number) => {
  for (let index = memo.count - 1; index >= 0; index--) if (memo.expires[index]! <= now) removeAt(memo, index);
};

const indexOf = (memo: PlotMemo, typeId: number, entry: number) => {
  for (let index = 0; index < memo.count; index++)
    if (memo.entries[index] === entry && memo.typeIds[index] === typeId) return index;
  return -1;
};

/** True while a failed plot's surroundings are unchanged; a changed one forgets its record. */
export const isMemoBlocked = (context: SettlementContext, owned: Uint8Array, memo: PlotMemo, typeId: number,
  entry: number) => {
  const index = indexOf(memo, typeId, entry);
  if (index < 0) return false;
  if (memo.fingerprints[index] === plotFingerprint(context, owned, typeId, entry)) return true;
  removeAt(memo, index);
  return false;
};

/** The record that gives way to a new one: the first free slot, else the one expiring first. */
const slotFor = (memo: PlotMemo) => {
  if (memo.count < PLOT_MEMO_CAPACITY) return memo.count++;
  let oldest = 0;
  for (let index = 1; index < memo.count; index++) if (memo.expires[index]! < memo.expires[oldest]!) oldest = index;
  return oldest;
};

/** Remembers a plot the real rules refused. */
export const rememberFailedPlot = (context: SettlementContext, owned: Uint8Array, memo: PlotMemo, typeId: number,
  entry: number, now: number) => {
  const slot = slotFor(memo);
  memo.entries[slot] = entry;
  memo.expires[slot] = now + secondsToTicks(PLOT_MEMO_SECONDS);
  memo.fingerprints[slot] = plotFingerprint(context, owned, typeId, entry);
  memo.typeIds[slot] = typeId;
};

export const saveMemo = (memo: PlotMemo): PlotMemoRecord[] => {
  const records: PlotMemoRecord[] = [];
  for (let index = 0; index < memo.count; index++)
    records.push({ entry: memo.entries[index]!, expires: memo.expires[index]!,
      fingerprint: memo.fingerprints[index]!, typeId: memo.typeIds[index]! });
  return records;
};

export const restoreMemo = (memo: PlotMemo, records: readonly PlotMemoRecord[] | undefined) => {
  memo.count = 0;
  for (const { entry, expires, fingerprint, typeId } of records ?? []) {
    const slot = memo.count++;
    memo.entries[slot] = entry;
    memo.expires[slot] = expires;
    memo.fingerprints[slot] = fingerprint;
    memo.typeIds[slot] = typeId;
  }
};
