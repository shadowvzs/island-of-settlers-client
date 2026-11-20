import { FOG, type WorldData } from "../world/world-data";
import type { SettlementSaveV1 } from "./settlement-save-state";

/**
 * Two FNV-1a 32-bit lanes (different offsets): a 64-bit fingerprint built from integer math only,
 * so every JavaScript engine and the server produce the same digest. Not a cryptographic hash.
 */
interface HashLanes { high: number; low: number }

const FNV_PRIME = 0x01000193;
const createLanes = (): HashLanes => ({ high: 0x811c9dc5, low: 0x050c5d1f });

const mixUnit = (lanes: HashLanes, unit: number) => {
  lanes.high = Math.imul(lanes.high ^ unit, FNV_PRIME);
  lanes.low = Math.imul(lanes.low ^ unit ^ 0x5bd1e995, FNV_PRIME);
};

const mixText = (lanes: HashLanes, text: string) => {
  for (let index = 0; index < text.length; index++) mixUnit(lanes, text.charCodeAt(index));
  mixUnit(lanes, 0xffff);
};

const mixBytes = (lanes: HashLanes, view: ArrayBufferView) => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  for (let index = 0; index < bytes.length; index++) mixUnit(lanes, bytes[index]!);
  mixUnit(lanes, 0x1ff);
};

const digest = (lanes: HashLanes) =>
  (lanes.high >>> 0).toString(16).padStart(8, "0") + (lanes.low >>> 0).toString(16).padStart(8, "0");

/** The 64-bit fingerprint of a text (canonical JSON of saved state, a command log line). */
export const hashText = (text: string) => {
  const lanes = createLanes();
  mixText(lanes, text);
  return digest(lanes);
};

/**
 * The 64-bit fingerprint of a list of numbers (counter checksums): integers mix as two 32-bit units, so every
 * engine agrees; a non-integer mixes its exact decimal text.
 */
export const hashNumbers = (values: readonly number[]) => {
  const lanes = createLanes();
  for (const value of values) {
    if (!Number.isSafeInteger(value)) { mixText(lanes, String(value)); continue; }
    mixUnit(lanes, value | 0);
    mixUnit(lanes, Math.floor(value / 4294967296) | 0);
  }
  return digest(lanes);
};

/** What one state hash covers: the island save, the world resources and the outer runtime state. */
export interface SettlementHashInput {
  /** Live tree growth/felling/animal state and player progress (JSON-safe); omitted when not run. */
  runtime?: unknown;
  settlement: SettlementSaveV1;
  world: WorldData;
}

/**
 * The fog in its saved form (A13 phase 2): live sight is derived from positions, territory and permanent
 * sight, so a visible cell without permanent sight mixes as discovered, exactly as a load reads it back.
 * The uploaded snapshot (no simulation) and the replayed island therefore hash alike.
 */
const mixSavedFog = (lanes: HashLanes, world: WorldData) => {
  const { fog, permanentFog } = world;
  for (let cell = 0; cell < fog.length; cell++) {
    const value = fog[cell]!;
    const live = value === FOG.visible && permanentFog !== undefined && permanentFog[cell] !== FOG.visible;
    mixUnit(lanes, live ? FOG.discovered : value);
  }
  mixUnit(lanes, 0x1ff);
};

/**
 * The world layers the simulation changes: ore left, terrain heights (levelling), explored fog (scouting)
 * and the live props (trees planted/felled, boulders). Only the used prop slots count (pool capacity is free).
 * The sway `phase` is presentation: saves omit it and a load derives it from the seed and slot.
 */
const mixWorldResources = (lanes: HashLanes, world: WorldData) => {
  const count = world.props.count;
  mixUnit(lanes, count & 0xffff);
  mixUnit(lanes, count >>> 16);
  mixBytes(lanes, world.oreAmount);
  mixBytes(lanes, world.heights);
  mixSavedFog(lanes, world);
  for (const field of ["types", "x", "z"] as const) mixBytes(lanes, world.props[field].subarray(0, count));
};

const sortedKeys = (_key: string, value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || ArrayBuffer.isView(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = (value as Record<string, unknown>)[key];
  return sorted;
};

/**
 * JSON with every object's keys sorted (SAVE-DRIFT 2026-11-11). Insertion order is not state: a live
 * object keeps the slot of a field once set to `undefined`, while the same object loaded from JSON adds
 * it again at the end, so a reloaded island and the uninterrupted one listed equal state differently.
 */
export const canonicalJson = (value: unknown) => JSON.stringify(value, sortedKeys);

/**
 * One state hash (BACKEND-03): the full settlement save as canonical JSON (exact doubles: any divergence
 * shows), the changed world layers and the runtime state.
 */
export const hashSettlementState = ({ runtime, settlement, world }: SettlementHashInput) => {
  const lanes = createLanes();
  mixText(lanes, canonicalJson(settlement));
  mixWorldResources(lanes, world);
  if (runtime !== undefined) mixText(lanes, canonicalJson(runtime));
  return digest(lanes);
};
