import { entriesWithTag, type PropEntry } from "@shared/catalog";

import { releasePropCells } from "../build-class";
import { isBlockingProp } from "../generation/gameplay";
import { getCellsRegion, sampleSmooth } from "../grid-geometry";
import { invalidatePropCellIndex } from "../prop-cell-index";
import { BLOCKING, PROP, type WorldData } from "../world-data";
import { aquaticDecorationSpot } from "./aquatic-decoration";
import { refreshWalkCost } from "./build-refresh";
import type { EditRefusal } from "./edit-refusal";
import { checkPropSpot } from "./prop-placement";
import { STONE_PROPS } from "./prop-removal";

/**
 * Existing ground decorations only (the catalog's `groundDecoration` props: English name and prop byte, in
 * palette order); trees retain their own growth/felling authoring tools.
 */
export const DECORATION_KINDS: readonly (readonly [name: string, kind: number])[] =
  (entriesWithTag("groundDecoration") as readonly PropEntry[]).map(entry => [entry.text.name.en, entry.code] as const);

const KINDS = new Set<number>(DECORATION_KINDS.map(([, kind]) => kind));

/** A ground decoration model kind (stones, shrubs, flowers, reeds; trees excluded). */
export const isDecorationKind = (kind: number) => KINDS.has(kind);

export const isDecoration = (world: WorldData, id: number) =>
  Number.isInteger(id) && id >= 0 && id < world.props.count && isDecorationKind(world.props.types[id]!);

export const decorationScaleLimits = (kind: number) =>
  ({ min: .5, max: kind === PROP.pebbles ? 1.2 : 1.5 });

export interface DecorationTransform {
  rotation: number;
  scale: number;
  x: number;
  z: number;
}

/** Selection is a click-time bounded-radius query; no full prop scans in the render loop. */
export const findDecoration = (world: WorldData, x: number, z: number, radius = 1.5) => {
  let selected = -1;
  let distance = radius * radius;
  for (let id = 0; id < world.props.count; id++) {
    if (!isDecoration(world, id)) continue;
    const dx = world.props.x[id]! - x;
    const dz = world.props.z[id]! - z;
    const squared = dx * dx + dz * dz;
    if (squared > distance) continue;
    selected = id;
    distance = squared;
  }
  return selected;
};

/** Same-cell rotation/scaling may ignore its own blocker, never another prop's blocker. */
const checkMoveSpot = (world: WorldData, id: number, next: DecorationTransform): EditRefusal | null => {
  const kind = world.props.types[id]!;
  const refusal = checkPropSpot(world, kind, next.x, next.z);
  if (refusal !== "blocked") return refusal;
  const cell = Math.floor(next.z) * world.cellsX + Math.floor(next.x);
  if (STONE_PROPS.has(kind) && world.settlementGroundClearance?.[cell]) return "blocked";
  const oldCell = Math.floor(world.props.z[id]!) * world.cellsX + Math.floor(world.props.x[id]!);
  if (cell !== oldCell) return "blocked";
  for (let other = 0; other < world.props.count; other++) {
    if (other === id || !isBlockingProp(world.props.types[other]!)) continue;
    const at = Math.floor(world.props.z[other]!) * world.cellsX + Math.floor(world.props.x[other]!);
    if (at === cell) return "blocked";
  }
  return null;
};

/** Keep the stable prop id and existing map layers: saves and undo retain every transform. */
export const transformDecoration = (world: WorldData, id: number, next: DecorationTransform) => {
  if (!isDecoration(world, id)) return { refusal: "blocked" as const };
  if (!Object.values(next).every(Number.isFinite)) return { refusal: "outside" as const };
  const refusal = checkMoveSpot(world, id, next);
  if (refusal) return { refusal };
  const { props } = world;
  const kind = props.types[id]!;
  const limits = decorationScaleLimits(kind);
  const previous = Math.floor(props.z[id]!) * world.cellsX + Math.floor(props.x[id]!);
  const target = Math.floor(next.z) * world.cellsX + Math.floor(next.x);
  props.x[id] = next.x;
  props.z[id] = next.z;
  const aquatic = aquaticDecorationSpot(world, kind, next.x, next.z);
  props.y[id] = aquatic && "y" in aquatic ? aquatic.y : sampleSmooth(world, world.heights, next.x, next.z);
  props.rotation[id] = ((next.rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  props.scale[id] = Math.max(limits.min, Math.min(limits.max, next.scale));
  // The prop moved in place: the cell indexes must not answer from its old cell in this transaction.
  invalidatePropCellIndex(world);
  if (isBlockingProp(kind)) world.blocking[target] = BLOCKING.prop;
  const affected = new Set([previous, target]);
  releasePropCells(world, affected);
  const cells = getCellsRegion(world, [...affected]);
  refreshWalkCost(world, cells);
  return { cells, refusal: null, stoneCells: STONE_PROPS.has(kind) ? cells : undefined };
};
