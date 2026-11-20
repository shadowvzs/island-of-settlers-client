import type { MountainTemplate } from "./mountain-template";
import {
  getFootprintRatio,
  getMaxLevel,
  getStampRadius,
  type TerrainStamp
} from "./terrain-stamps";

/**
 * The terrain edits of a map: the stamps and what applying them needs (the ground before the
 * first stamp, what was applied per vertex, the gravel ring cells, the stamps' props); a saved
 * map keeps all of it (save/map-terrain.ts).
 */
export interface TerrainEditState {
  /** Heights, splat and water surface before any stamp (captured with the first stamp). */
  base: { heights: Float32Array; splat: Uint8Array; waterSurface: Float32Array } | null;
  /** Vertices a lake reached when last applied. */
  lake: Uint8Array | null;
  nextId: number;
  /** Gravel ring weight last applied per vertex. */
  ring: Float32Array | null;
  /** Rise last applied per vertex (0 where no stamp changed the ground). */
  rise: Float32Array | null;
  /** Cells the stamps turned into gravel ring (mine land). */
  ringCells: Set<number>;
  /** World props of the stamps (boulders of low mountains, a lake's water plants) per id. */
  stampProps: Map<number, number[]>;
  stamps: TerrainStamp[];
}

/** One stamp before and after an edit (null: it did not exist / was removed). */
export interface StampChange {
  after: TerrainStamp | null;
  before: TerrainStamp | null;
}

/** Share of the footprint radius within which a click picks an existing stamp. */
const PICK_SHARE = 0.4;
/** A click picks a stamp at least this close to its spine (cells; small stamps). */
const PICK_MIN = 1.5;

export const createTerrainEditState = (): TerrainEditState => ({
  base: null,
  lake: null,
  nextId: 1,
  ring: null,
  rise: null,
  ringCells: new Set(),
  stampProps: new Map(),
  stamps: []
});

/** Kind of stamp a tool edits: "lake", or undefined for mountains. */
export type StampKind = TerrainStamp["kind"];

/** Footprint ratio within which a click picks the stamp (its pick zone around the spine). */
export const getPickRatio = (stamp: TerrainStamp) =>
  Math.max(PICK_SHARE, PICK_MIN / getStampRadius(stamp));

/**
 * The stamp of the kind whose spine is nearest to the point, if the point is close enough to
 * pick it.
 */
export const findStampAt = (state: TerrainEditState, x: number, z: number, kind?: StampKind) => {
  let best: TerrainStamp | null = null;
  let bestRatio = Infinity;
  for (const stamp of state.stamps) {
    if (stamp.kind !== kind) continue;
    const ratio = getFootprintRatio(stamp, x, z);
    if (ratio < getPickRatio(stamp) && ratio < bestRatio) {
      best = stamp;
      bestRatio = ratio;
    }
  }
  return best;
};

const replaceStamp = (
  state: TerrainEditState,
  before: TerrainStamp,
  after: TerrainStamp | null
) => {
  state.stamps = state.stamps.flatMap((stamp) => {
    if (stamp !== before) return [stamp];
    return after ? [after] : [];
  });
};

/** A new stamp (peak, or ridge with `to`) of the kind at the level; returns the change. */
export const addStamp = (
  state: TerrainEditState,
  at: { x: number; z: number },
  level: number,
  seed: number,
  options: { kind?: StampKind; template?: MountainTemplate; to?: { x: number; z: number } } = {}
): StampChange => {
  const { kind, template, to } = options;
  const after: TerrainStamp = {
    id: state.nextId,
    kind,
    level,
    seed,
    ...(kind !== "lake" && template ? { template } : {}),
    toX: to?.x,
    toZ: to?.z,
    ...at
  };
  state.nextId += 1;
  state.stamps = [...state.stamps, after];
  return { after, before: null };
};

/**
 * A click raises the stamp of the kind under the point one level (a mountain higher, a lake
 * deeper and wider; up to the kind's top level) or starts a new one at level 1.
 */
export const raiseStampAt = (
  state: TerrainEditState,
  x: number,
  z: number,
  seed: number,
  kind?: StampKind,
  template?: MountainTemplate
) => {
  const before = findStampAt(state, x, z, kind);
  if (!before) return addStamp(state, { x, z }, 1, seed, { kind, template });
  if (before.level >= getMaxLevel(before)) return { after: before, before };
  const after = { ...before, level: before.level + 1 };
  replaceStamp(state, before, after);
  return { after, before };
};

/**
 * Ctrl + click takes the stamp of the kind under the point one level back (removed at 0); null
 * when there is none.
 */
export const lowerStampAt = (state: TerrainEditState, x: number, z: number, kind?: StampKind) => {
  const before = findStampAt(state, x, z, kind);
  if (!before) return null;
  const after = before.level > 1 ? { ...before, level: before.level - 1 } : null;
  replaceStamp(state, before, after);
  return { after, before };
};

/** What a Mountain / Lake click does: its kind, its seed and whether it lowers. */
export interface StampClick {
  kind?: StampKind;
  template?: MountainTemplate;
  /** Ctrl + click, or a click with the editor's Lower toggle on (Ctrl flips it back). */
  lower: boolean;
  seed: number;
}

/** A Mountain / Lake click: the stamp under the point a level up, or with `lower` a level back. */
export const clickStampAt = (
  state: TerrainEditState,
  point: { x: number; z: number },
  { kind, lower, seed, template }: StampClick
) =>
  lower
    ? lowerStampAt(state, point.x, point.z, kind)
    : raiseStampAt(state, point.x, point.z, seed, kind, template);

/**
 * Removes every stamp (mountain or lake) whose footprint reaches the circle (reset ground);
 * returns the changes (each stamp to nothing).
 */
export const removeStampsNear = (
  state: TerrainEditState,
  x: number,
  z: number,
  radius: number
): StampChange[] => {
  const reached = state.stamps.filter(
    (stamp) => getFootprintRatio(stamp, x, z) < 1 + radius / getStampRadius(stamp)
  );
  state.stamps = state.stamps.filter((stamp) => !reached.includes(stamp));
  return reached.map((before) => ({ after: null, before }));
};

/** Edits a tracked feature by stable id, preserving its profile and translating ridge endpoints. */
export const editTerrainFeature = (
  state: TerrainEditState, id: number, values: { x: number; z: number; level: number } | null
): StampChange | null => {
  const before = state.stamps.find(stamp => stamp.id === id);
  if (!before) return null;
  if (!values) { replaceStamp(state, before, null); return { before, after: null }; }
  if (!Number.isFinite(values.x) || !Number.isFinite(values.z) || !Number.isInteger(values.level) ||
    values.level < 1 || values.level > getMaxLevel(before)) return null;
  if (before.x === values.x && before.z === values.z && before.level === values.level) return null;
  const dx = values.x - before.x, dz = values.z - before.z;
  const after = { ...before, ...values,
    toX: before.toX === undefined ? undefined : before.toX + dx,
    toZ: before.toZ === undefined ? undefined : before.toZ + dz };
  replaceStamp(state, before, after);
  return { before, after };
};
