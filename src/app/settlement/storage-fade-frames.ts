import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import type { StorageFade } from "../../shared/settlement/stranded-relocation";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** Seconds a relocated person takes to fade out where it stood and in at the storage. */
export const STORAGE_FADE_SECONDS = 1.2;
/** Ghost frames get their own crowd member, apart from any simulation actor id. */
const GHOST_ID_BASE = -1_000_000;

interface ActiveFade {
  age: number;
  fade: StorageFade;
  /** The person as last seen before it moved: drawn fading out at the old spot. */
  ghost?: WorkerFrame;
}

/**
 * Presentation of the simulation's storage relocations (cut-off carriers, stranded people; never read
 * back by the simulation): the figure fades out where it stood while it fades in at the storage.
 */
export const createStorageFadeFrames = (world: Pick<WorldData, "cellsX" | "cellsZ" | "heights">) => {
  const active: ActiveFade[] = [];
  return (workers: WorkerFrame[], started: readonly StorageFade[], dt: number) => {
    for (const fade of started) active.push({ age: 0, fade });
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const entry = active[index]!;
      entry.age += dt;
      if (entry.age >= STORAGE_FADE_SECONDS) active.splice(index, 1);
    }
    for (const entry of active) {
      const share = entry.age / STORAGE_FADE_SECONDS;
      const frame = workers.find(worker => worker.actorId === entry.fade.actor);
      if (frame) frame.fade = share;
      entry.ghost ??= frame && { ...frame, actorId: GHOST_ID_BASE - entry.fade.actor, selected: false,
        x: entry.fade.from.x, y: sampleSmooth(world, world.heights, entry.fade.from.x, entry.fade.from.z),
        z: entry.fade.from.z };
      if (entry.ghost) workers.push({ ...entry.ghost, fade: 1 - share });
    }
  };
};
