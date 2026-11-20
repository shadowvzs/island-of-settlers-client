import type { FellingFrame } from "../../render-common/felling/felling-simulation";
import type { LeafParticles } from "../../render-common/felling/leaf-particles";
import type { FellingState } from "../../render-common/felling/tree-felling";
import type { GrowingTree, GrowthFrame } from "../../render-common/growth/tree-growth";
import type { FrameState } from "../../render-common/renderer-contract";

/**
 * Felling and growth frames are live views (functions): a recording stores their data. Parts
 * equal to the previous stored frame's are left out (`grown` while `revision` is unchanged) and
 * inherited on playback.
 */
interface FellingData { felled?: [number, FellingState][]; leaves: LeafParticles }
interface GrowthData { growing?: GrowingTree[]; grown?: number[]; revision: number }
export type SceneFrameData = Omit<FrameState, "felling" | "growth"> & { felling: FellingData; growth: GrowthData };
type PoolRecord = Record<string, unknown> & { count: number };

/** Growth progress steps smaller than this are not stored again (a stage lasts minutes). */
const GROWTH_STEP = .005;
const STANDING: FellingState = { chop: [0, 0, 0, 0], phase: "standing", showStump: false, showTree: true };
/** Slot pools whose live entries are the first `count` slots. */
const POOLS = ["animals", "birds", "butterflies", "critters"] as const;

const isPool = (value: unknown): value is PoolRecord =>
  Boolean(value) && typeof (value as PoolRecord).count === "number";

/** Only the live slots of a pool (and of its nested pools, e.g. the critters' ripples). */
const trimPool = (pool: PoolRecord): PoolRecord => {
  const lengths = Object.values(pool).flatMap(value => ArrayBuffer.isView(value) ? [(value as Uint8Array).length] : []);
  const capacity = Math.min(...lengths);
  if (!Number.isFinite(capacity) || capacity <= 0) return pool;
  const trimmed: PoolRecord = { ...pool };
  for (const [key, value] of Object.entries(pool)) {
    if (ArrayBuffer.isView(value)) {
      const array = value as Uint8Array;
      trimmed[key] = array.subarray(0, Math.min(array.length, pool.count * (array.length / capacity)));
    } else if (isPool(value)) trimmed[key] = trimPool(value);
  }
  return trimmed;
};

/** Leaves are drawn over the whole capacity while visible: keep up to the last visible one. */
const trimLeaves = (leaves: LeafParticles): LeafParticles => {
  let live = leaves.alpha.length;
  while (live > 0 && !(leaves.alpha[live - 1]! > 0)) live--;
  const trimmed = { ...leaves, capacity: live } as Record<string, unknown>;
  for (const [key, value] of Object.entries(leaves))
    if (ArrayBuffer.isView(value)) trimmed[key] = (value as Uint8Array).subarray(0, live);
  return trimmed as unknown as LeafParticles;
};

const sameGrowth = (before: readonly GrowingTree[] | undefined, after: readonly GrowingTree[]) =>
  before?.length === after.length && after.every((tree, index) => tree.id === before[index]!.id &&
    tree.stage === before[index]!.stage && Math.abs(tree.progress - before[index]!.progress) < GROWTH_STEP);

/**
 * The frame as plain data: what the trees were doing when it was drawn, only live pool slots, and
 * revision-keyed parts (roads, territory borders, grown trees) only when they changed.
 */
export const snapshotSceneFrame = (frame: FrameState, previous?: SceneFrameData): SceneFrameData => {
  const revision = frame.growth.revision();
  const felled = [...frame.felling.felledIds()].map((id): [number, FellingState] => [id, frame.felling.getState(id)]);
  const growing = [...frame.growth.growing()];
  const data: SceneFrameData = {
    ...frame,
    felling: { leaves: trimLeaves(frame.felling.leaves) },
    growth: { revision }
  };
  if (previous?.growth.revision !== revision) data.growth.grown = [...frame.growth.grownIds()];
  if (!previous?.felling.felled || JSON.stringify(previous.felling.felled) !== JSON.stringify(felled))
    data.felling.felled = felled;
  if (!sameGrowth(previous?.growth.growing, growing)) data.growth.growing = growing;
  for (const pool of POOLS) if (isPool(frame[pool])) Object.assign(data, { [pool]: trimPool(frame[pool] as PoolRecord) });
  if (previous && frame.roadRevision !== undefined && previous.roadRevision === frame.roadRevision) delete data.roads;
  const sameBorders = frame.territoryRevision !== undefined && previous?.territoryRevision === frame.territoryRevision;
  if (sameBorders) delete data.territoryBorders;
  return data;
};

/** Fills the parts a frame left out from the frame before it (shared references, no copies). */
export const inheritSharedFields = (frames: readonly SceneFrameData[]) => {
  for (let index = 1; index < frames.length; index++) {
    const frame = frames[index]!;
    const before = frames[index - 1]!;
    if (!frame.roads && frame.roadRevision === before.roadRevision) frame.roads = before.roads;
    if (!frame.territoryBorders && frame.territoryRevision === before.territoryRevision)
      frame.territoryBorders = before.territoryBorders;
    if (!frame.growth.grown && frame.growth.revision === before.growth.revision) frame.growth.grown = before.growth.grown;
    frame.growth.growing ??= before.growth.growing;
    frame.felling.felled ??= before.felling.felled;
  }
};

const restoreFelling = ({ felled = [], leaves }: FellingData): FellingFrame => {
  const states = new Map(felled);
  return { felledIds: () => states.keys(), getState: id => states.get(id) ?? STANDING, leaves };
};

const restoreGrowth = ({ growing = [], grown = [], revision }: GrowthData): GrowthFrame => {
  const growingIds = new Set(growing.map(tree => tree.id));
  const grownIds = new Set(grown);
  return { growing: () => growing, grownIds: () => grownIds, isGrowing: id => growingIds.has(id),
    isGrown: id => grownIds.has(id), revision: () => revision };
};

const restored = new WeakMap<SceneFrameData, FrameState>();

/** The renderer's frame contract again, built once per recorded frame. */
export const restoreSceneFrame = (data: SceneFrameData): FrameState => {
  const cached = restored.get(data);
  if (cached) return cached;
  const frame = { ...data, felling: restoreFelling(data.felling), growth: restoreGrowth(data.growth) };
  restored.set(data, frame);
  return frame;
};
