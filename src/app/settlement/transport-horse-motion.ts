import { MOUNT_CLIPS } from "@workers/mount-clips";

import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import type { TransportHorseFrame } from "../../shared/settlement/settlement-horses";
import { createMotionSmoother } from "./actor-motion-smoothing";

/** Ground covered by one walk cycle; the same scale as the cavalry horses use. */
const WALK_CYCLE = MOUNT_CLIPS.walk.speed * WORKER_SCALE;

/** Riders holding their horse on the lead (adventure landing): the rope from the hand to its halter. */
export const holdLeadRopes = (workers: readonly WorkerFrame[], horses: readonly TransportHorseFrame[]) => {
  const held = new Map(horses.flatMap(horse => horse.held && horse.leader !== undefined
    ? [[horse.leader, horse.id] as const] : []));
  if (!held.size) return;
  for (const worker of workers) {
    const horseId = held.get(worker.actorId ?? NaN);
    if (horseId !== undefined && !worker.horseLead) worker.horseLead = { horseId };
  }
};

/**
 * The commander's horse standing on a troop ship's deck is posed with the drawn (bobbing) hull, as the passengers
 * are, instead of its simulation place.
 */
export const poseDeckHorses = (horses: TransportHorseFrame[],
  poses: ReadonlyMap<number, { x: number; y: number; yaw: number; z: number }>) => {
  if (!poses.size) return horses;
  return horses.map(frame => {
    const pose = poses.get(frame.id);
    return pose && frame.visible !== false ? { ...frame, heading: pose.yaw, x: pose.x, y: pose.y, z: pose.z } : frame;
  });
};

/**
 * Waiting and led mounts: drawn between simulation ticks like settlers, with the walk clip
 * advanced by the distance actually covered, so hooves stay planted at any road speed.
 */
export const createTransportHorseMotion = () => {
  const motion = createMotionSmoother();
  const walkTimes = new Map<number, number>();
  const shown = new Map<number, { x: number; z: number }>();
  return (frames: readonly TransportHorseFrame[], fraction: number, dt: number): TransportHorseFrame[] => {
    const drawn = new Set<number>();
    const result = frames.map(frame => {
      if (frame.visible === false) return frame;
      drawn.add(frame.id);
      const pose = motion.smooth(frame.id, { x: frame.x, y: frame.y, yaw: frame.heading, z: frame.z }, fraction, dt);
      const previous = shown.get(frame.id);
      const moved = previous ? Math.hypot(pose.x - previous.x, pose.z - previous.z) : 0;
      shown.set(frame.id, { x: pose.x, z: pose.z });
      const walkTime = ((walkTimes.get(frame.id) ?? 0) + moved / WALK_CYCLE) % MOUNT_CLIPS.walk.duration;
      walkTimes.set(frame.id, walkTime);
      return { ...frame, heading: pose.yaw, walkTime, x: pose.x, y: pose.y, z: pose.z };
    });
    motion.retain(drawn);
    for (const id of walkTimes.keys()) {
      if (drawn.has(id)) continue;
      // A horse no longer listed (its rider got on it) is hidden once, not left standing.
      result.push({ heading: 0, id, moving: false, visible: false, x: 0, y: 0, z: 0 });
      walkTimes.delete(id); shown.delete(id);
    }
    return result;
  };
};
