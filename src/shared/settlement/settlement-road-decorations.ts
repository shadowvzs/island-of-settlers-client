import { getRoadDecorationItem, type RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { MOUNTED_NAVIGATION_RADIUS } from "../../render-common/mounts/horse-dimensions";
import type { RoadDecorationBounds } from "../../render-common/road-decoration-clearance";
import type { ScenarioDecoration } from "../world/scenario-decorations";
import {
  type AuthoredDecorationState, createAuthoredDecorationState, toAuthoredDecorationSave
} from "./authored-decorations";
import { removeBridge } from "./bridge-dismantling";
import { bridgeIdAt } from "./bridge-removal";
import { toMapSceneryUid } from "./map-scenery";
import { createRoadDecorationContext } from "./road-decoration-context";
import { createRoadDecorationState, type RoadDecorationFrame, type RoadDecorationOrder } from "./road-decoration-state";
import { decorationClearsRoadTraffic } from "./road-decoration-traffic";
import type { RoadSegment } from "./road-types";
import { bumpNavigationRevision } from "./settlement-reservations";
import { afterRoadsRemoved } from "./settlement-road-removal";
import { isBuiltCell } from "./settlement-ruins";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export interface RoadDecorationCustodyPort {
  consume: (item: RoadDecorationItemId) => boolean;
  receive: (items: Readonly<Record<string, number>>) => boolean;
  onReturns?: () => void;
}

const NO_FRAMES: readonly RoadDecorationFrame[] = [];

/**
 * Fixed map scenery (owner 2026-11-10): the played map's authored decorations. They occupy space and render
 * like placed decorations but belong to nobody: no custody, pick-up, move, limits or selection. Their frames
 * carry negative uids (the renderer never picks or outlines them); their rows persist as the save's snapshot.
 */
const createMapScenery = (context: SettlementContext) => {
  // Created on the first spawn: maps without authored decorations keep no extra owner or checks.
  let state: AuthoredDecorationState | undefined;
  let rows: readonly ScenarioDecoration[] = [];
  let cached = NO_FRAMES, cachedRevision = -1;
  return {
    framesNear: (bounds: RoadDecorationBounds) => state?.framesNear(bounds) ?? NO_FRAMES,
    isFree: (bounds: RoadDecorationBounds) => state?.isFree(bounds) ?? true,
    isSupportClear: (point: { x: number; z: number }, radius: number) => state?.isSupportClear(point, radius) ?? true,
    revision: () => state?.revision() ?? 0,
    rows: () => rows,
    /** Spawns the rows once (map start or save restore); refused rows are dropped deterministically. */
    spawn: (next: readonly ScenarioDecoration[]) => {
      rows = structuredClone([...next]);
      if (!rows.length && !state) return;
      state ??= createAuthoredDecorationState(context);
      state.load(toAuthoredDecorationSave(rows));
    },
    frames: () => {
      if (!state) return NO_FRAMES;
      if (cachedRevision === state.revision()) return cached;
      cached = state.frames().map(frame => ({ ...frame, uid: toMapSceneryUid(frame.uid) }));
      cachedRevision = state.revision();
      return cached;
    }
  };
};

export const createSettlementRoadDecorations = (context: SettlementContext) => {
  const adapter = createRoadDecorationContext(context);
  const scenery = createMapScenery(context);
  // Player decorations keep clear of the fixed scenery's real model volumes.
  const ownerContext = () => {
    const base = adapter.create();
    return { ...base, isFree: (bounds: RoadDecorationBounds) => base.isFree(bounds) && scenery.isFree(bounds) };
  };
  const owner = createRoadDecorationState(ownerContext, () => context.options.roadDecorationCustody?.onReturns?.());
  let combined: readonly RoadDecorationFrame[] = [], combinedKey = "";
  /** Player frames, then the scenery (the same list object while unchanged; no scenery: the owner's list). */
  const frames = () => {
    const sceneryFrames = scenery.frames();
    if (!sceneryFrames.length) return owner.frames();
    const key = `${owner.revision()}:${scenery.revision()}`;
    if (key !== combinedKey) { combined = [...owner.frames(), ...sceneryFrames]; combinedKey = key; }
    return combined;
  };
  const isFree = (bounds: RoadDecorationBounds, ignoreUid?: number) =>
    owner.isFree(bounds, ignoreUid) && scenery.isFree(bounds);
  const framesNear = (bounds: RoadDecorationBounds) => [...owner.framesNear(bounds), ...scenery.framesNear(bounds)];
  const flush = () => {
    if (!owner.counters().dirty) return;
    const result = owner.flushDirty();
    if (result.checked) bumpNavigationRevision(context);
  };
  return {
    ...owner,
    /** Continue only work explicitly queued by a structural edit, at most256 instances per fixed tick. */
    processPending: flush,
    roadYaw: adapter.roadYaw,
    roadPlacementClear: (segments: readonly RoadSegment[]) => segments.every(segment => {
      const nearby = framesNear({ min: [Math.min(segment.start.x, segment.end.x) - 1.5, -1e6,
        Math.min(segment.start.z, segment.end.z) - 1.5], max: [Math.max(segment.start.x, segment.end.x) + 1.5,
        1e6, Math.max(segment.start.z, segment.end.z) + 1.5] });
      const heightAt = adapter.create().heightAt;
      return nearby.every(frame => decorationClearsRoadTraffic(frame.volumes, [segment], heightAt,
        getRoadDecorationItem(frame.item)?.plant ? MOUNTED_NAVIGATION_RADIUS : 0));
    }),
    buildingPlacementClear: (building: SettlementBuilding) => frames().length === 0 ||
      adapter.buildingBoxes(building).every(bounds => isFree(bounds)),
    frames,
    framesNear,
    isFree,
    isSupportClear: (point: { x: number; z: number }, radius = 0) =>
      owner.isSupportClear(point, radius) && scenery.isSupportClear(point, radius),
    revision: () => owner.revision() + scenery.revision(),
    /** Fixed map scenery rows (save snapshot) and their one-time spawn. */
    sceneryRows: scenery.rows,
    spawnScenery: scenery.spawn,
    changedBuilding: (building: SettlementBuilding) => {
      adapter.invalidate();
      if (!owner.hasState() || context.restoringRoadDecorations) return;
      const boxes = adapter.buildingBoxes(building);
      owner.markBounds({ min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]!))) as [number, number, number],
        max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]!))) as [number, number, number] });
      flush();
    },
    place: (request: RoadDecorationOrder) => {
      const result = owner.place(request, item => context.options.roadDecorationCustody?.consume(item) ?? false);
      if (result.ok) bumpNavigationRevision(context);
      return result;
    },
    pickUp: (uid: number) => {
      const result = owner.pickUp(uid); if (result.returned) bumpNavigationRevision(context); return result;
    },
    move: (uid: number, position: RoadDecorationOrder["position"], yaw: number) => {
      const result = owner.move(uid, position, yaw);
      if (result.ok) bumpNavigationRevision(context);
      return result;
    },
    rotate: (uid: number) => {
      const result = owner.rotate(uid);
      if (result.ok) bumpNavigationRevision(context);
      return result;
    },
    claimReturns: (ids: readonly number[]) => owner.claimReturns(ids,
      items => context.options.roadDecorationCustody?.receive(items) ?? false),
    changedBounds: (bounds: RoadDecorationBounds) => {
      adapter.invalidate(); owner.markBounds(bounds); flush();
    },
    changedRoads: (edges: readonly Pick<RoadSegment, "start" | "end">[]) => {
      for (const edge of edges) owner.markBounds({
        min: [Math.min(edge.start.x, edge.end.x) - 1.5, -1e6, Math.min(edge.start.z, edge.end.z) - 1.5],
        max: [Math.max(edge.start.x, edge.end.x) + 1.5, 1e6, Math.max(edge.start.z, edge.end.z) + 1.5]
      });
      flush();
    },
    invalidate: () => { adapter.invalidate(); owner.markAll(); flush(); },
    load: (saved: Parameters<typeof owner.load>[0]) => { adapter.invalidate(); owner.load(saved); }
  };
};
export type SettlementRoadDecorations = ReturnType<typeof createSettlementRoadDecorations>;

export const roadDecorationCommands = (context: SettlementContext) => ({
  roadDecorations: context.roadDecorations!.frames,
  roadDecorationRevision: context.roadDecorations!.revision,
  roadDecorationCounters: context.roadDecorations!.counters,
  roadDecorationRoadYaw: context.roadDecorations!.roadYaw,
  planRoadDecoration: context.roadDecorations!.plan,
  planRoadDecorationMove: context.roadDecorations!.planMove,
  placeRoadDecoration: (request: RoadDecorationOrder) => context.roadDecorations!.place(request),
  moveRoadDecoration: (uid: number, position: RoadDecorationOrder["position"], yaw: number) =>
    context.roadDecorations!.move(uid, position, yaw),
  rotateRoadDecoration: (uid: number) => context.roadDecorations!.rotate(uid),
  pickUpRoadDecoration: (uid: number) => context.roadDecorations!.pickUp(uid),
  pendingRoadDecorationReturns: context.roadDecorations!.returns,
  claimRoadDecorationReturns: (ids: readonly number[]) => context.roadDecorations!.claimReturns(ids),
  removeRoad: (start: { x: number; z: number }, end: { x: number; z: number }) => {
    // A bridge tile removes the whole bridge under the bridge rules (people off the deck, waits).
    const bridge = bridgeIdAt(context, start, end);
    if (bridge !== undefined) return removeBridge(context, bridge).ok;
    if (!context.options.roads.removeRoad?.(start, end)) return false;
    afterRoadsRemoved(context, [{ end, start }]);
    return true;
  },
  isOccupied: (x: number, z: number) => context.roadDecorations?.isSupportClear({ x, z }) === false ||
    isBuiltCell(context.occupied[Math.floor(z) * context.options.world.cellsX + Math.floor(x)]) ||
    context.fieldCycles!.isOccupied(x, z)
});
