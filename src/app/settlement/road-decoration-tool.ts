import type { RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { RoadDecorationGhostFrame } from "../../render-common/renderer-contract";
import type { RoadDecorationOrder } from "../../shared/settlement/road-decoration-state";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

interface Point { x: number; z: number }
interface Options {
  simulation: SettlementSimulation;
  world: WorldData;
  held(item: RoadDecorationItemId): number;
  commit(order: RoadDecorationOrder): Promise<true | string>;
  commitMove?(uid: number, order: RoadDecorationOrder): Promise<true | string>;
  changed(): void;
  message(text: string): void;
}

/** Clear the other placement modes only after the current island accepts a relocation gesture. */
export const createRoadDecorationMoveControl = (options: {
  canCommand?: () => boolean;
  cancel(): void;
  changed(): void;
  move(uid: number): boolean;
}) => (uid: number) => {
  if (options.canCommand?.() === false) return false;
  options.cancel();
  const accepted = options.move(uid);
  options.changed();
  return accepted;
};

/** Absolute pointer placement, optional nearby-road angle help, and one awaited private custody mutation. */
export const createRoadDecorationTool = ({ changed, commit, commitMove, held, message, simulation, world }: Options) => {
  let item: RoadDecorationItemId | null = null, order: RoadDecorationOrder | undefined, manualYaw: number | undefined;
  let movingUid: number | undefined;
  let ghost: RoadDecorationGhostFrame | null = null, reason = "", stamp = "", busy = false, generation = 0;
  const cancel = () => {
    item = null; movingUid = undefined; ghost = null; order = undefined; stamp = ""; manualYaw = undefined; generation++;
  };
  const update = (point: Point | null) => {
    if (!item || !point) { ghost = null; order = undefined; return; }
    const signature = [item, movingUid, point.x.toFixed(4), point.z.toFixed(4), manualYaw, held(item), world.buildRevision, world.terrainRevision,
      simulation.navigationRevision(), simulation.roadRevision(), simulation.roadDecorationRevision()].join(":");
    if (stamp === signature) return;
    stamp = signature;
    const yaw = manualYaw ?? simulation.roadDecorationRoadYaw(point) ?? 0;
    order = { item, position: { x: point.x, z: point.z }, yaw };
    const result = movingUid === undefined ? simulation.planRoadDecoration(order) :
      simulation.planRoadDecorationMove(movingUid, order.position, order.yaw);
    reason = result.ok ? "" : result.reason;
    if (movingUid === undefined && !held(item)) reason = "A matching road decoration item is required";
    if (result.ok) { ghost = { item, position: result.position, yaw: result.yaw, valid: !reason }; return; }
    // Refused visual poses never authorize placement or mutate world/inventory.
    const height = sampleSmooth(world, world.heights, point.x, point.z);
    ghost = { item, position: [point.x, Number.isFinite(height) ? height : 0, point.z], yaw, valid: false };
  };
  return {
    cancel, update, active: () => item !== null, selected: () => item, ghost: () => ghost,
    select: (next: RoadDecorationItemId) => { cancel(); item = next; },
    move: (uid: number) => {
      const frame = simulation.roadDecorations().find(entry => entry.uid === uid);
      if (!frame) return false;
      cancel(); item = frame.item; movingUid = uid; manualYaw = frame.yaw;
      return true;
    },
    rotate: () => { manualYaw = ((ghost?.yaw ?? manualYaw ?? 0) + Math.PI / 4) % (Math.PI * 2); stamp = ""; },
    place: async () => {
      if (busy || !item || !order) return;
      if (reason || !ghost?.valid) { message(reason || "Cannot place here"); return; }
      const selected = generation, request = structuredClone(order), uid = movingUid; busy = true;
      try {
        const result = uid === undefined ? await commit(request) :
          await (commitMove?.(uid, request) ?? Promise.resolve("Road decoration custody is unavailable"));
        if (result !== true) message(result);
        else if (generation === selected) { cancel(); changed(); }
      } finally { busy = false; stamp = ""; }
    }
  };
};
