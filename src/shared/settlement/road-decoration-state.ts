import { getRoadDecorationItem, type RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { RoadDecorationBounds } from "../../render-common/road-decoration-clearance";
import { planRoadDecorationPlacement, type RoadDecorationPlacementContext, type RoadDecorationPlacementRequest }
  from "./road-decoration-placement";
import { MAX_ISLAND_ROAD_DECORATIONS, roadDecorationSaveProblem } from "./road-decoration-save";

export interface RoadDecorationOrder extends Omit<RoadDecorationPlacementRequest, "decoration"> { item: RoadDecorationItemId }
export interface SavedRoadDecoration extends RoadDecorationOrder { uid: number }
export interface RoadDecorationReturn { id: number; source: number; item: RoadDecorationItemId; reason: string }
export interface RoadDecorationSave {
  nextUid: number;
  nextReturn: number;
  placed: SavedRoadDecoration[];
  returns: RoadDecorationReturn[];
}
export interface RoadDecorationFrame extends Omit<SavedRoadDecoration, "position"> {
  position: readonly [number, number, number];
  yaw: number;
  volumes: readonly RoadDecorationBounds[];
  supports: readonly RoadDecorationBounds[];
}
const empty = (): RoadDecorationSave => ({ nextUid: 1, nextReturn: 1, placed: [], returns: [] });
const intersects = (a: RoadDecorationBounds, b: RoadDecorationBounds) =>
  [0, 1, 2].every(axis => a.min[axis]! < b.max[axis]! - .000001 && a.max[axis]! > b.min[axis]! + .000001);
const allBounds = (volumes: readonly RoadDecorationBounds[]): RoadDecorationBounds => ({
  min: [0, 1, 2].map(axis => Math.min(...volumes.map(box => box.min[axis]!))) as [number, number, number],
  max: [0, 1, 2].map(axis => Math.max(...volumes.map(box => box.max[axis]!))) as [number, number, number]
});
/** A12: integer chunk keys (were `x:z` strings); unique while |chunk x| < half the stride. */
const CHUNK_KEY_STRIDE = 65_536;
const chunks = (bounds: RoadDecorationBounds) => {
  const keys: number[] = [];
  for (let z = Math.floor(bounds.min[2] / 4); z <= Math.floor(bounds.max[2] / 4); z++)
    for (let x = Math.floor(bounds.min[0] / 4); x <= Math.floor(bounds.max[0] / 4); x++)
      keys.push(z * CHUNK_KEY_STRIDE + x);
  return keys;
};

/** Whether every low support of the frame (below head height) leaves the point's clearance free. */
const isFrameSupportClear = (frame: RoadDecorationFrame, point: { x: number; z: number }, radius: number) =>
  frame.volumes.every(support => {
    if (!(support.min[1] < frame.position[1] + 2.1 - 1e-6)) return true;
    const dx = Math.max(support.min[0] - point.x, 0, point.x - support.max[0]);
    const dz = Math.max(support.min[2] - point.z, 0, point.z - support.max[2]);
    return radius > 0 ? dx * dx + dz * dz >= radius * radius :
      point.x <= support.min[0] || point.x >= support.max[0] || point.z <= support.min[2] || point.z >= support.max[2];
  });

/** Event-driven world owner. Inventory transfers are explicit callbacks inside the caller's custody transaction. */
/**
 * Packed authoring (owner 2026-11-10, map decorations): rows of this owner keep half a tile between
 * centres instead of model clearance against each other; `spotClear` adds the caller's own spacing rule.
 */
export interface PackedDecorationSpacing {
  minSpacing: number;
  spotClear: (point: { x: number; z: number }) => boolean;
}

export const createRoadDecorationState = (context: (item: RoadDecorationItemId, ignoreUid?: number) => RoadDecorationPlacementContext,
  onReturns: () => void = () => undefined, packed?: PackedDecorationSpacing) => {
  let state = empty(), revision = 0, validations = 0;
  let frameList: readonly RoadDecorationFrame[] = [], frameListRevision = -1;
  const frames = new Map<number, RoadDecorationFrame>();
  const buckets = new Map<number, Set<number>>(), memberships = new Map<number, number[]>(), dirty = new Set<number>();
  const index = (frame: RoadDecorationFrame) => {
    frames.set(frame.uid, frame);
    const cells = chunks(allBounds(frame.volumes)); memberships.set(frame.uid, cells);
    for (const cell of cells) { const list = buckets.get(cell) ?? new Set<number>(); list.add(frame.uid); buckets.set(cell, list); }
  };
  const unindex = (uid: number) => {
    const frame = frames.get(uid); if (!frame) return;
    for (const cell of memberships.get(uid) ?? []) {
      const list = buckets.get(cell); list?.delete(uid); if (!list?.size) buckets.delete(cell);
    }
    memberships.delete(uid); frames.delete(uid); dirty.delete(uid);
  };
  const nearby = (bounds: RoadDecorationBounds) => {
    const result = new Set<number>();
    for (const cell of chunks(bounds)) for (const uid of buckets.get(cell) ?? []) result.add(uid);
    return [...result].sort((a, b) => a - b);
  };
  const isFree = (bounds: RoadDecorationBounds, ignoreUid?: number) => nearby(bounds).every(uid =>
    uid === ignoreUid || !frames.get(uid)!.volumes.some(box => intersects(box, bounds)));
  /** Packed rows: no other centre of this owner within the minimum spacing (the ignored row excepted). */
  const isPackedSpotClear = (point: { x: number; z: number }, ignoreUid?: number) => {
    const spacing = packed!.minSpacing;
    const near = nearby({ min: [point.x - spacing, 0, point.z - spacing], max: [point.x + spacing, 0, point.z + spacing] });
    return packed!.spotClear(point) && near.every(uid => uid === ignoreUid ||
      (frames.get(uid)!.position[0] - point.x) ** 2 + (frames.get(uid)!.position[2] - point.z) ** 2 >= spacing * spacing);
  };
  const plan = (order: RoadDecorationOrder, ignoreUid?: number) => {
    const item = getRoadDecorationItem(order.item);
    if (!item) return { ok: false as const, reason: "unknown-decoration-item" };
    validations++;
    if (packed && !isPackedSpotClear(order.position, ignoreUid)) return { ok: false as const, reason: "decoration-spacing" };
    const source = context(order.item, ignoreUid);
    return planRoadDecorationPlacement({ ...order, decoration: item.decoration }, {
      ...source,
      isFree: bounds => source.isFree(bounds) && (packed !== undefined || isFree(bounds, ignoreUid))
    });
  };
  const returnPlaced = (uid: number, reason: string) => {
    const frame = frames.get(uid); if (!frame) return false;
    unindex(uid); state.placed = state.placed.filter(row => row.uid !== uid);
    state.returns.push({ id: state.nextReturn++, source: uid, item: frame.item, reason }); revision++;
    onReturns(); return true;
  };
  const planMove = (uid: number, position: RoadDecorationOrder["position"], yaw: number) => {
    const frame = frames.get(uid);
    if (!frame) return { ok: false as const, reason: "decoration-not-placed" };
    return plan({ item: frame.item, position, yaw }, uid);
  };
  const move = (uid: number, position: RoadDecorationOrder["position"], yaw: number) => {
    const frame = frames.get(uid);
    if (!frame) return { ok: false as const, reason: "decoration-not-placed" };
    const result = planMove(uid, position, yaw);
    if (!result.ok) return result;
    const saved: SavedRoadDecoration = { uid, item: frame.item, position: { ...position }, yaw: result.yaw };
    unindex(uid);
    state.placed = state.placed.map(row => row.uid === uid ? saved : row);
    index({ ...saved, ...result }); revision++;
    return { ok: true as const, uid, item: frame.item };
  };
  return {
    plan,
    planMove,
    move,
    rotate: (uid: number) => {
      const frame = frames.get(uid);
      if (!frame) return { ok: false as const, reason: "decoration-not-placed" };
      const next = (frame.yaw + Math.PI / 2) % (Math.PI * 2);
      const yaw = next < 0 ? next + Math.PI * 2 : next;
      return move(uid, { x: frame.position[0], z: frame.position[2] }, yaw);
    },
    isFree,
    framesNear: (bounds: RoadDecorationBounds) => nearby(bounds).map(uid => frames.get(uid)!),
    /**
     * A12: the same conjunction over every frame filed in the box's chunks, without collecting,
     * de-duplicating and sorting their uids first (a pure test: order and repeats cannot matter).
     */
    isSupportClear: (point: { x: number; z: number }, radius = 0) => {
      if (!frames.size) return true;
      // The chunks of the box (point ± radius), visited without building the box or its key list.
      for (let z = Math.floor((point.z - radius) / 4); z <= Math.floor((point.z + radius) / 4); z++)
        for (let x = Math.floor((point.x - radius) / 4); x <= Math.floor((point.x + radius) / 4); x++) {
          const bucket = buckets.get(z * CHUNK_KEY_STRIDE + x);
          if (bucket) for (const uid of bucket) if (!isFrameSupportClear(frames.get(uid)!, point, radius)) return false;
        }
      return true;
    },
    place: (order: RoadDecorationOrder, consume: (item: RoadDecorationItemId) => boolean) => {
      const result = plan(order);
      if (!result.ok) return result;
      if (state.placed.length + state.returns.length >= MAX_ISLAND_ROAD_DECORATIONS ||
        state.nextUid >= Number.MAX_SAFE_INTEGER || state.nextReturn >= Number.MAX_SAFE_INTEGER)
        return { ok: false as const, reason: "decoration-capacity" };
      if (!consume(order.item)) return { ok: false as const, reason: "decoration-item-required" };
      const saved: SavedRoadDecoration = { ...structuredClone(order), uid: state.nextUid++ };
      const frame: RoadDecorationFrame = { ...saved, ...result };
      state.placed.push(saved); index(frame); revision++;
      return { ok: true as const, uid: saved.uid };
    },
    pickUp: (uid: number) => ({ ok: true as const, returned: returnPlaced(uid, "picked-up") ? 1 : 0 }),
    returns: () => state.returns,
    claimReturns: (ids: readonly number[], receive: (items: Readonly<Record<string, number>>) => boolean) => {
      const selected = new Set(ids), rows = state.returns.filter(row => selected.has(row.id));
      if (!rows.length) return { ok: true as const, returned: 0 };
      const items: Record<string, number> = {};
      for (const row of rows) items[row.item] = (items[row.item] ?? 0) + 1;
      if (!receive(items)) return { ok: false as const, reason: "decoration-return-pending" };
      state.returns = state.returns.filter(row => !selected.has(row.id)); revision++;
      return { ok: true as const, returned: rows.length };
    },
    markBounds: (bounds: RoadDecorationBounds) => { for (const uid of nearby(bounds)) dirty.add(uid); },
    markAll: () => { for (const uid of frames.keys()) dirty.add(uid); },
    /** Caller drains bounded batches at the structural mutation barrier, never every unchanged frame. */
    flushDirty: (limit = 256) => {
      let checked = 0;
      for (const uid of dirty) {
        if (checked >= limit) break;
        dirty.delete(uid); const frame = frames.get(uid); if (!frame) continue;
        const result = plan({ item: frame.item, yaw: frame.yaw,
          position: { x: frame.position[0], z: frame.position[2] } }, uid); checked++;
        if (!result.ok) returnPlaced(uid, result.reason);
        else { unindex(uid); index({ ...frame, ...result }); revision++; }
      }
      return { checked, remaining: dirty.size };
    },
    frames: () => {
      if (frameListRevision !== revision) { frameList = [...frames.values()]; frameListRevision = revision; }
      return frameList;
    },
    revision: () => revision,
    hasState: () => state.nextUid > 1 || state.nextReturn > 1 || state.placed.length > 0 || state.returns.length > 0,
    counters: () => ({ validations, dirty: dirty.size, instances: frames.size, buckets: buckets.size }),
    save: (): RoadDecorationSave => structuredClone(state),
    /** Strict schema validation belongs before this entry; invalid physical support returns its existing custody once. */
    load: (saved: RoadDecorationSave | undefined) => {
      const problem = roadDecorationSaveProblem(saved);
      if (problem) throw new Error(problem);
      frames.clear(); buckets.clear(); memberships.clear(); dirty.clear(); state = structuredClone(saved ?? empty());
      for (const row of [...state.placed].sort((a, b) => a.uid - b.uid)) {
        const result = plan(row, row.uid);
        if (result.ok) index({ ...row, ...result });
        else { state.placed = state.placed.filter(candidate => candidate.uid !== row.uid);
          state.returns.push({ id: state.nextReturn++, source: row.uid, item: row.item, reason: result.reason }); }
      }
      revision++;
      if (state.returns.length) onReturns();
    }
  };
};
export type RoadDecorationState = ReturnType<typeof createRoadDecorationState>;
