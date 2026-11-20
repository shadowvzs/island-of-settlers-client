import type { WorkerFrame } from "../../render-common/workers/worker-unit";

/** Figures closer than this (tiles) visibly step aside; the simulation lets them overlap. */
const NUDGE_RADIUS = .5;
/** How fast a figure eases into and out of its side step (per second). */
const EASE_RATE = 8;
/** Cell of the civilian lookup (tiles); a soldier checks its own cell and the neighbours. */
const CELL = 1;

interface Offset { x: number; z: number }
const cellKey = (x: number, z: number) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);

/**
 * Renderer only (owner decision 2026-10-13): soldiers and civilian workers pass through each other
 * in the simulation; where they meet, both figures ease half the overlap aside, so nobody visibly
 * walks through anyone. Works on the drawn frames only (no simulation cost, every detail level).
 */
export const createPassThroughNudge = () => {
  const offsets = new Map<number, Offset>();
  const targets = new Map<number, Offset>();
  const civilians = new Map<number, WorkerFrame[]>();
  const addTarget = (frame: WorkerFrame, x: number, z: number) => {
    const target = targets.get(frame.actorId!) ?? { x: 0, z: 0 };
    target.x += x; target.z += z; targets.set(frame.actorId!, target);
  };
  /** Pushes a soldier and a civilian standing too close apart, each by half the overlap. */
  const separate = (soldier: WorkerFrame, civilian: WorkerFrame) => {
    const dx = civilian.x - soldier.x, dz = civilian.z - soldier.z, distance = Math.hypot(dx, dz);
    if (distance >= NUDGE_RADIUS) return;
    // Exactly on top of each other: the civilian steps to the soldier's right.
    const close = distance < 1e-4;
    const ux = close ? Math.cos(soldier.heading) : dx / distance;
    const uz = close ? -Math.sin(soldier.heading) : dz / distance;
    const push = (NUDGE_RADIUS - distance) / 2;
    addTarget(civilian, ux * push, uz * push);
    addTarget(soldier, -ux * push, -uz * push);
  };
  const collectTargets = (frames: readonly WorkerFrame[]) => {
    targets.clear(); civilians.clear();
    const soldiers = frames.filter(frame => frame.workerJob === "Soldier" && frame.actorId !== undefined);
    if (!soldiers.length) return;
    for (const frame of frames) {
      if (frame.workerJob === "Soldier" || frame.actorId === undefined) continue;
      const key = cellKey(frame.x, frame.z), list = civilians.get(key);
      if (list) list.push(frame); else civilians.set(key, [frame]);
    }
    for (const soldier of soldiers) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      for (const civilian of civilians.get(cellKey(soldier.x + dx * CELL, soldier.z + dz * CELL)) ?? [])
        separate(soldier, civilian);
  };
  /** The side step currently applied to a figure (subtract it to get the simulated position). */
  const offset = (id: number): Offset => offsets.get(id) ?? { x: 0, z: 0 };
  /** Eases every figure towards its side step and shifts the frames by it. */
  const apply = (frames: readonly WorkerFrame[], dt: number) => {
    collectTargets(frames);
    const blend = Math.min(1, dt * EASE_RATE);
    for (const frame of frames) {
      const id = frame.actorId;
      if (id === undefined) continue;
      const current = offsets.get(id), target = targets.get(id);
      if (!current && !target) continue;
      const next = current ?? { x: 0, z: 0 };
      next.x += ((target?.x ?? 0) - next.x) * blend; next.z += ((target?.z ?? 0) - next.z) * blend;
      if (!target && Math.hypot(next.x, next.z) < 1e-3) { offsets.delete(id); continue; }
      offsets.set(id, next);
      frame.x += next.x; frame.z += next.z;
    }
  };
  return { apply, offset, retain: (drawn: ReadonlySet<number>) => {
    for (const id of offsets.keys()) if (!drawn.has(id)) offsets.delete(id);
  } };
};
