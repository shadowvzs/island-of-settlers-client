import type { CameraState } from "../../render-common/camera-state";
import type { FrameState } from "../../render-common/renderer-contract";
import type { ShipFrame } from "../../render-common/ships/ship-frame";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";

/** A body that moved further than this (world units) between two snapshots jumped: no blending. */
const TELEPORT_DISTANCE = 3;
const TURN = Math.PI * 2;

/** Slot pools (animals, birds, butterflies, critters) blended per slot of the same species. */
interface SlotFrame { count: number; heading: Float32Array; species: Uint8Array; x: Float32Array; y: Float32Array;
  z: Float32Array }
type SlotKey = "animals" | "birds" | "butterflies" | "critters";
const SLOT_POOLS: readonly SlotKey[] = ["animals", "birds", "butterflies", "critters"];
const SLOT_FIELDS = ["heading", "x", "y", "z"] as const;

const lerp = (from: number, to: number, weight: number) => from + (to - from) * weight;

/** Shortest way round between two angles (radians). */
export const lerpAngle = (from: number, to: number, weight: number) => {
  const turn = ((to - from) % TURN + TURN * 1.5) % TURN - Math.PI;
  return from + turn * weight;
};

const lerpPhase = (from: number, to: number, weight: number) => {
  const step = ((to - from) % 1 + 1.5) % 1 - .5;
  return ((from + step * weight) % 1 + 1) % 1;
};

const jumped = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.hypot(to.x - from.x, to.z - from.z) > TELEPORT_DISTANCE;

const blendCamera = (from: CameraState, to: CameraState, weight: number): CameraState => ({
  ...from,
  centerX: lerp(from.centerX, to.centerX, weight),
  centerZ: lerp(from.centerZ, to.centerZ, weight),
  tilt: lerp(from.tilt, to.tilt, weight),
  yaw: lerpAngle(from.yaw, to.yaw, weight),
  zoom: from.zoom * (to.zoom / from.zoom) ** weight
});

const blendWorker = (from: WorkerFrame, to: WorkerFrame | undefined, weight: number): WorkerFrame => {
  if (!to || jumped(from, to)) return from;
  const sameAction = from.action === to.action;
  return {
    ...from,
    animationTime: sameAction && to.animationTime >= from.animationTime
      ? lerp(from.animationTime, to.animationTime, weight) : from.animationTime,
    gaitPhase: sameAction ? lerpPhase(from.gaitPhase, to.gaitPhase, weight) : from.gaitPhase,
    heading: lerpAngle(from.heading, to.heading, weight),
    x: lerp(from.x, to.x, weight),
    y: lerp(from.y, to.y, weight),
    z: lerp(from.z, to.z, weight)
  };
};

/** Workers keep their simulation actor ID; without IDs only an unchanged roster blends by index. */
const blendWorkers = (from: readonly WorkerFrame[] | undefined, to: readonly WorkerFrame[] | undefined,
  weight: number) => {
  if (!from || !to) return from;
  const byActor = new Map(to.flatMap(worker => worker.actorId === undefined ? [] : [[worker.actorId, worker]]));
  const sameRoster = from.length === to.length;
  return from.map((worker, index) => {
    if (worker.actorId !== undefined) return blendWorker(worker, byActor.get(worker.actorId), weight);
    return blendWorker(worker, sameRoster ? to[index] : undefined, weight);
  });
};

const blendShip = (from: ShipFrame, to: ShipFrame | undefined, weight: number): ShipFrame => {
  if (!to || jumped(from, to)) return from;
  return { ...from, x: lerp(from.x, to.x, weight), y: lerp(from.y, to.y, weight), yaw: lerpAngle(from.yaw, to.yaw,
    weight), z: lerp(from.z, to.z, weight) };
};

const blendShips = (from: readonly ShipFrame[] | undefined, to: readonly ShipFrame[] | undefined, weight: number) => {
  if (!from || !to) return from;
  const byId = new Map(to.map(ship => [ship.id, ship]));
  return from.map(ship => blendShip(ship, byId.get(ship.id), weight));
};

/** Reused output arrays per pool field: playback allocates nothing per frame for the pools. */
const createSlotBlender = () => {
  const scratch = new Map<string, Float32Array>();
  const output = (key: string, length: number) => {
    let array = scratch.get(key);
    if (!array || array.length < length) scratch.set(key, array = new Float32Array(length));
    return array;
  };
  return (pool: SlotKey, from: SlotFrame, to: SlotFrame, weight: number): SlotFrame => {
    const blended = { ...from };
    for (const field of SLOT_FIELDS) {
      const target = output(`${pool}.${field}`, from[field].length);
      target.set(from[field]);
      blended[field] = target;
    }
    for (let slot = 0; slot < Math.min(from.count, to.count); slot++) {
      const sameBody = from.species[slot] === to.species[slot] &&
        Math.hypot(to.x[slot]! - from.x[slot]!, to.z[slot]! - from.z[slot]!) <= TELEPORT_DISTANCE;
      if (!sameBody) continue;
      blended.heading[slot] = lerpAngle(from.heading[slot]!, to.heading[slot]!, weight);
      blended.x[slot] = lerp(from.x[slot]!, to.x[slot]!, weight);
      blended.y[slot] = lerp(from.y[slot]!, to.y[slot]!, weight);
      blended.z[slot] = lerp(from.z[slot]!, to.z[slot]!, weight);
    }
    return blended;
  };
};

/**
 * Smooth playback between the 10 Hz snapshots: camera, workers, ships and wildlife move on
 * straight lines between two recorded frames; everything else shows the earlier frame.
 */
export const createFrameInterpolator = () => {
  const blendSlots = createSlotBlender();
  return (from: FrameState, to: FrameState | undefined, weight: number): FrameState => {
    if (!to || to === from || weight <= 0) return from;
    const blended: FrameState = {
      ...from,
      camera: blendCamera(from.camera, to.camera, weight),
      ships: blendShips(from.ships, to.ships, weight),
      time: lerp(from.time, to.time, weight),
      workers: blendWorkers(from.workers, to.workers, weight)
    };
    for (const pool of SLOT_POOLS) {
      const source = from[pool] as unknown as SlotFrame | undefined;
      const target = to[pool] as unknown as SlotFrame | undefined;
      if (source?.x && target?.x) (blended[pool] as unknown) = blendSlots(pool, source, target, weight);
    }
    return blended;
  };
};
