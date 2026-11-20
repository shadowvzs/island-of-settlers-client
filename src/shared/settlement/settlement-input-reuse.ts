import type { TileRect } from "../world/navigation-change-log";
import { shouldVerifyNavigationReuse } from "./navigation-change-journal";
import {
  captureInputFingerprint, clampInputRect, type InputFingerprint, inputIdentity, sameInputFingerprint,
  unionInputRect
} from "./settlement-input-fingerprint";
import { noteInputRects, recordInputReads } from "./settlement-input-reads";
import type { SettlementContext } from "./settlement-types";

/**
 * JETTY-FRAMES: a cached harbour geometry with the inputs it read. It is confirmed at most once per
 * cache revision (`checked`); a confirmed value is the value a fresh computation returns now.
 */
export interface ReusableValue<Value> {
  checked: string;
  /** Null: reuse is off for this context (A03 rollback, `findWorkerPath`); renew on every revision. */
  fingerprint: InputFingerprint | null;
  value: Value;
}

/**
 * Computes `compute` and copies its inputs: the fixed `rect` it scans (cells and terrain) plus every
 * tile it noted (`settlement-input-reads.ts`), its ground searches included; settlement objects only
 * where those searches read. The copy is taken right after the
 * computation, while nothing else has run.
 */
export const computeReusable = <Value>(context: SettlementContext, checked: string, rect: TileRect,
  compute: () => Value): ReusableValue<Value> => {
  const { cells, navigation, reads, value } = recordInputReads(compute);
  if (inputIdentity(context) === null) return { checked, fingerprint: null, value };
  const { world } = context.options, terrain = clampInputRect(world, unionInputRect(rect, reads));
  if (!terrain) return { checked, fingerprint: null, value };
  const rects = { cells: clampInputRect(world, unionInputRect(rect, cells)),
    navigation: navigation && clampInputRect(world, navigation), terrain };
  return { checked, fingerprint: captureInputFingerprint(context, rects), value };
};

/**
 * True when the cached value still holds at revision `checked`: every copied input is unchanged. Its
 * reads are noted for an enclosing recording (a reused value is read again by its reuser).
 * Strict mode (and every few reuses in development builds) recomputes it and throws on a difference.
 */
export const confirmReusable = <Value>(context: SettlementContext, entry: ReusableValue<Value>, checked: string,
  recompute: () => Value, label: string) => {
  if (entry.checked === checked) {
    if (entry.fingerprint) noteInputRects(entry.fingerprint.rects);
    return true;
  }
  if (!entry.fingerprint || !sameInputFingerprint(context, entry.fingerprint)) return false;
  noteInputRects(entry.fingerprint.rects);
  if (shouldVerifyNavigationReuse()) {
    const kept = JSON.stringify(entry.value), fresh = JSON.stringify(recompute());
    if (kept !== fresh) throw new Error(`Stale ${label}: kept ${kept}, now ${fresh}`);
  }
  entry.checked = checked;
  return true;
};
