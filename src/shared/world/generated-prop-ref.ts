import { listShoreShellSpots } from "../../render-common/props/shore-shell-spots";
import { COLONY_RESOURCE_TIERS } from "./colony-resource-tiers";
import { getAuthoredDeposits, type MarbleDeposit } from "./marble-deposit";
import { PROP_REMOVED, type WorldData } from "./world-data";

/**
 * References to objects the map file does not author one by one (ACT1): generated trees, rocks and ground
 * props (`world.props`), shore shells (`listShoreShellSpots` order) and stone deposits (their slot id). The
 * index alone is not an identity — regeneration or an edit may give it to another object — so every
 * reference keeps a fingerprint (kind and position) that validation re-checks before a script trusts it.
 */
export type GeneratedPropLayer = "deposit" | "prop" | "shell";

export interface GeneratedPropFingerprint {
  /** Prop type byte, shell mesh id or the `COLONY_RESOURCE_TIERS` index of a deposit's stone. */
  kind: number;
  /** Position rounded to 0.01 cell. */
  x: number;
  z: number;
}

export interface GeneratedPropRef {
  fingerprint: GeneratedPropFingerprint;
  index: number;
  layer: GeneratedPropLayer;
}

/**
 * `ok`: the index still holds the fingerprinted object. `reindexed`: the identical object (same kind and
 * position) sits at another index. `moved`: the nearest object of that kind within `REBIND_RADIUS` — only a
 * rebind suggestion for the author, never applied silently. `missing`: nothing matches.
 */
export type GeneratedPropResolution =
  | { index: number; status: "moved" | "ok" | "reindexed" }
  | { status: "missing" };

/** How far a moved object may be from its fingerprint to be offered as a rebind (cells). */
export const REBIND_RADIUS = .5;
const FINGERPRINT_STEP = 100;
/** Half a rounding step plus float32 noise: two positions with one rounded fingerprint compare equal. */
const SAME_POSITION = .5 / FINGERPRINT_STEP + 1e-4;

const round = (value: number) => Math.round(value * FINGERPRINT_STEP) / FINGERPRINT_STEP;
const fingerprint = (kind: number, x: number, z: number): GeneratedPropFingerprint =>
  ({ kind, x: round(x), z: round(z) });

const depositKind = (deposit: MarbleDeposit) =>
  COLONY_RESOURCE_TIERS.findIndex(pair => pair.stone === (deposit.material ?? "marble"));

/** Every object of a layer as `[index, kind, x, z]`, in index order (removed props excluded). */
const layerObjects = (world: WorldData, layer: GeneratedPropLayer): [number, number, number, number][] => {
  if (layer === "shell") return listShoreShellSpots(world).map((spot, index) => [index, spot.meshId, spot.x, spot.z]);
  if (layer === "deposit") return getAuthoredDeposits(world).map(deposit => [deposit.id, depositKind(deposit), deposit.x,
    deposit.z]);
  const { props } = world;
  const objects: [number, number, number, number][] = [];
  for (let index = 0; index < props.count; index++) {
    const type = props.types[index]!;
    if (type !== PROP_REMOVED) objects.push([index, type, props.x[index]!, props.z[index]!]);
  }
  return objects;
};

const objectAt = (world: WorldData, layer: GeneratedPropLayer, index: number) => {
  if (layer === "deposit") return layerObjects(world, layer).find(([id]) => id === index);
  if (layer === "shell") return layerObjects(world, layer)[index];
  const { props } = world;
  if (!Number.isSafeInteger(index) || index < 0 || index >= props.count) return undefined;
  const type = props.types[index]!;
  if (type === PROP_REMOVED) return undefined;
  return [index, type, props.x[index]!, props.z[index]!] as const;
};

/** The fingerprint of the object at a layer index now, or null when there is none. */
export const generatedPropFingerprint = (world: WorldData, layer: GeneratedPropLayer, index: number) => {
  const found = objectAt(world, layer, index);
  return found ? fingerprint(found[1], found[2], found[3]) : null;
};

/** A reference to the object at a layer index, with its current fingerprint (null when there is none). */
export const createGeneratedPropRef = (world: WorldData, layer: GeneratedPropLayer, index: number) => {
  const print = generatedPropFingerprint(world, layer, index);
  return print ? { fingerprint: print, index, layer } satisfies GeneratedPropRef : null;
};

const squaredDistance = (print: GeneratedPropFingerprint, x: number, z: number) =>
  (print.x - x) ** 2 + (print.z - z) ** 2;

const isSame = (print: GeneratedPropFingerprint, kind: number, x: number, z: number) =>
  kind === print.kind && Math.abs(print.x - x) <= SAME_POSITION && Math.abs(print.z - z) <= SAME_POSITION;

/** The nearest same-kind object within the rebind radius; exact matches first, ties by lower index. */
const searchLayer = (world: WorldData, ref: GeneratedPropRef): GeneratedPropResolution => {
  let best: { distance: number; index: number } | null = null;
  for (const [index, kind, x, z] of layerObjects(world, ref.layer)) {
    if (kind !== ref.fingerprint.kind) continue;
    if (isSame(ref.fingerprint, kind, x, z)) return { index, status: "reindexed" };
    const distance = squaredDistance(ref.fingerprint, x, z);
    if (distance <= REBIND_RADIUS ** 2 && (!best || distance < best.distance)) best = { distance, index };
  }
  return best ? { index: best.index, status: "moved" } : { status: "missing" };
};

/** Re-checks a stored reference against the world (Ready validation, after a map save/load or replace). */
export const resolveGeneratedProp = (world: WorldData, ref: GeneratedPropRef): GeneratedPropResolution => {
  const found = objectAt(world, ref.layer, ref.index);
  if (found && isSame(ref.fingerprint, found[1], found[2], found[3])) return { index: ref.index, status: "ok" };
  return searchLayer(world, ref);
};
