import { DMath } from "../../shared/math/deterministic-math";
import { auditRandom } from "../../shared/settlement/simulation-random";
import { createRandom, createStatefulRandom, type Random } from "../../shared/world/rng";
import { createLeafParticles, type LeafParticles } from "./leaf-particles";
import {
  createFellingController,
  type FellingEvent,
  type FellingPhase,
  type FellingState
} from "./tree-felling";

export const LEAF_CAPACITY = 600;
const LEAF_STREAM_SALT = 0x1eaf5eed;
/** Leaf size relative to the crown radius (readable at the iso zoom, larger than real). */
const LEAF_SIZE = 0.09;

/** A choppable tree in world units: its foot and its crown (where leaves come from). */
export interface TreeBody {
  canopyHeight: number;
  canopyRadius: number;
  x: number;
  y: number;
  z: number;
}

/** What renderers read each frame. */
export interface FellingFrame {
  /** Trees whose felling has started (renderers only touch these). */
  felledIds: () => Iterable<number>;
  getState: (id: number) => FellingState;
  leaves: LeafParticles;
}

/**
 * Falls across the shared iso view (towards screen left or right, never towards or away from
 * the camera), so the topple reads in 3D and in 2D sprites alike.
 */
const chooseFallYaw = (random: Random) =>
  (random() < 0.5 ? -Math.PI / 4 : (Math.PI * 3) / 4) + (random() - 0.5) * 0.5;

/**
 * Felling of tree instances plus their falling leaves: each axe hit shakes leaves out of the
 * crown, the landing crown scatters more along the fall line.
 */
export const createFellingSimulation = (
  getTree: (id: number) => TreeBody | undefined,
  seed: number,
  /** When provided, harvested trees disappear completely after their fall. */
  onRemoved?: (id: number) => void
) => {
  /** Fall directions (saved, audited); the leaf bursts draw from a visual stream of their own. */
  const random = auditRandom("felling", createStatefulRandom(seed));
  const controller = createFellingController();
  const leaves = createLeafParticles(LEAF_CAPACITY, createRandom((seed ^ LEAF_STREAM_SALT) >>> 0));
  const fallYaws = new Map<number, number>();
  let now = 0;
  let previous: number | null = null;
  /** Drawing only: seconds past `now` the frame shows (the share of the next tick already elapsed). */
  let drawLead = 0;

  const spawnLeaves = (event: FellingEvent) => {
    const tree = getTree(event.id);
    if (!tree) return;
    const yaw = fallYaws.get(event.id) ?? 0;
    const impact = event.kind === "impact";
    const reach = impact ? tree.canopyHeight : 0;
    leaves.spawn({
      count: impact ? 40 : 16,
      ground: tree.y,
      radius: tree.canopyRadius * (impact ? 0.8 : 0.7),
      size: tree.canopyRadius * LEAF_SIZE,
      x: tree.x + DMath.cos(yaw) * reach,
      y: tree.y + (impact ? tree.canopyRadius * 0.4 : tree.canopyHeight),
      z: tree.z + DMath.sin(yaw) * reach
    });
  };

  /** The felling at `time`: leaf bursts and removals; returns the seconds since the previous advance. */
  const advance = (time: number) => {
    const deltaSeconds = previous === null ? 0 : Math.max(0, time - previous);
    previous = time;
    now = time;
    for (const event of controller.update(time)) spawnLeaves(event);
    if (onRemoved) for (const id of controller.ids()) {
      if (controller.getState(id, time).phase !== "stump") continue;
      onRemoved(id);
      controller.remove(id);
      fallYaws.delete(id);
    }
    return deltaSeconds;
  };

  /** Drawing between ticks: leaves fly on the frame clock, falls are shown `lead` seconds ahead. */
  const animate = (deltaSeconds: number, lead: number) => {
    leaves.update(deltaSeconds);
    drawLead = lead;
  };

  const update = (time: number) => {
    leaves.update(advance(time));
  };

  const fell = (id: number, rate = 1) => {
    const yaw = chooseFallYaw(random.at("felling.fallYaw", id));
    if (!controller.fell(id, now, yaw, rate)) return false;
    fallYaws.set(id, yaw);
    return true;
  };

  const frame: FellingFrame = {
    felledIds: controller.ids,
    getState: (id) => {
      const state = controller.getState(id, now + drawLead);
      return onRemoved ? { ...state, showStump: false } : state;
    },
    leaves: leaves.particles
  };

  const saveState = () => ({ controller: controller.saveState(), fallYaws: [...fallYaws], now,
    previous, randomState: random.getState() });
  const loadState = (saved: ReturnType<typeof saveState>) => {
    controller.loadState(saved.controller); fallYaws.clear();
    for (const [id,yaw] of saved.fallYaws) fallYaws.set(id,yaw);
    now=saved.now;previous=saved.previous;random.setState(saved.randomState);
  };
  return {
    advance,
    random,
    animate,
    saveState, loadState,
    countStumps: () => controller.countStumps(now),
    fell,
    frame,
    getPhase: (id: number): FellingPhase => controller.getState(id, now).phase,
    getWorkProgress: (id: number) => controller.getWorkProgress(id, now),
    remove: (id: number) => {
      controller.remove(id);
      fallYaws.delete(id);
    },
    reset: () => {
      controller.reset();
      fallYaws.clear();
    },
    update
  };
};
