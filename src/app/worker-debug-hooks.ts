import type { TerrainRenderer } from "../render-common/renderer-contract";
import { WORKER_HEIGHT } from "../render-common/workers/worker-dimensions";
import type { WorkerGroup } from "../render-common/workers/worker-group";
import type {
  StandingAction,
  WorkerAppearance,
  WorkerFrame
} from "../render-common/workers/worker-unit";
import { CIVILIAN_SIGHT } from "../shared/balance/vision";
import { sampleSmooth } from "../shared/world/grid-geometry";
import type { WorldData } from "../shared/world/world-data";

interface ScreenPoint {
  x: number;
  y: number;
}

declare global {
  interface Window {
    /** The first worker (Playwright worker checks). */
    __worker?: {
      getState: () => WorkerFrame;
      project: () => ScreenPoint;
      projectGround: (x: number, z: number) => ScreenPoint;
      /** The renderer's ground pick under a CSS pixel of the map (editor picking checks). */
      pickGround: (x: number, y: number) => { x: number; y: number; z: number } | null;
      command: (x: number, z: number) => boolean;
      fogAt: (x: number, z: number) => number;
      fogStats: () => {
        hidden: number;
        explored: number;
        visible: number;
        revision: number;
        sightRadius: number;
      };
    };
    /** Every worker of the player (Playwright group checks). */
    __workers?: {
      /** Sends the selected workers (a formation for several). */
      command: (x: number, z: number) => boolean;
      getStates: () => WorkerFrame[];
      /** Body centre of a worker on screen (the point box selection tests). */
      project: (index: number) => ScreenPoint;
      /** Selects exactly these workers. */
      select: (indices: readonly number[]) => void;
      /** Replaces the bodies (mixed nation screenshots); resolves false when superseded. */
      setAppearances: (appearances: readonly WorkerAppearance[]) => Promise<boolean>;
      /** What a worker does while standing (screenshots of working workers: chop_tree). */
      setStandingAction: (index: number, action: StandingAction) => void;
    };
  }
}

const countFog = (world: WorldData) => {
  const counts = [0, 0, 0];
  world.fog.forEach((fog) => counts[fog]!++);
  return counts;
};

/** Playwright hooks of the worker checks (tools/bench/worker-*.ts). */
export const connectWorkerDebugHooks = (
  group: WorkerGroup,
  renderer: TerrainRenderer,
  world: WorldData
) => {
  if (!import.meta.env.DEV) return;
  const first = group.units[0];
  // The standalone editor intentionally has no settlers; there is no first-worker hook to expose.
  if (!first) return;
  const projectBody = (frame: WorkerFrame) =>
    renderer.projectToViewport(frame.x, frame.y + WORKER_HEIGHT / 2, frame.z);
  window.__worker = {
    getState: () => ({ ...first.frame }),
    project: () => projectBody(first.frame),
    projectGround: (x, z) =>
      renderer.projectToViewport(x, sampleSmooth(world, world.heights, x, z), z),
    pickGround: renderer.pickGround,
    command: first.command,
    fogAt: (x, z) => world.fog[Math.floor(z) * world.cellsX + Math.floor(x)] ?? 0,
    fogStats: () => {
      const [hidden, explored, visible] = countFog(world);
      return {
        explored: explored!,
        hidden: hidden!,
        revision: world.fogRevision ?? 0,
        // A settlement's simulation owns the fog: its civilians see as far as a free worker did.
        sightRadius: first.vision?.radius ?? CIVILIAN_SIGHT,
        visible: visible!
      };
    }
  };
  window.__workers = {
    command: group.command,
    getStates: () => group.frames.map((frame) => ({ ...frame })),
    project: (index) => projectBody(group.frames[index]!),
    select: (indices) => group.select(group.frames.map((_, index) => indices.includes(index))),
    setAppearances: async (appearances) => {
      if (!(await renderer.setWorkerAppearances?.(appearances))) return false;
      group.frames.forEach((frame, index) => Object.assign(frame, appearances[index]));
      return true;
    },
    setStandingAction: (index, action) => group.units[index]?.setStandingAction(action)
  };
};
