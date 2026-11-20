import type { CameraState } from "../render-common/camera-state";
import {
  createFellingSimulation,
  type TreeBody
} from "../render-common/felling/felling-simulation";
import { collectChoppableTrees, getChoppableTree } from "../render-common/felling/felling-trees";
import { DMath } from "../shared/math/deterministic-math";
import { deriveSeed } from "../shared/world/rng";
import type { WorldData } from "../shared/world/world-data";
import { getCrownOnScreen, type Projector } from "./tree-picking";

interface IslandFellingOptions {
  camera: CameraState;
  /** False for trees that cannot be felled right now (growing saplings). */
  canFell: (id: number) => boolean;
  /** True for trees that grew mature (picked and felled with the mature crown). */
  isGrown: (id: number) => boolean;
  /** A tree was felled (the axe started on it). */
  onFelled: (id: number) => void;
  /** Clear the harvested prop once its fall animation finishes. */
  onRemoved: (id: number) => void;
  project: Projector;
  world: WorldData;
}

/**
 * Woodcutters start tree felling through resource jobs; the settlement tick advances the fall (the render loop
 * only on islands without a settlement).
 * The scripted screenshot helper projects with the active camera.
 */
export const createIslandFelling = ({
  camera,
  canFell,
  isGrown,
  onFelled,
  onRemoved,
  project,
  world
}: IslandFellingOptions) => {
  const worldBodies = new Map(collectChoppableTrees(world));
  const matureBodies = new Map(collectChoppableTrees(world, true));
  const getBody = (id: number) => {
    const body = (isGrown(id) ? matureBodies : worldBodies).get(id);
    if (body) body.y = world.props.y[id] ?? body.y;
    return body;
  };
  /** Current [id, body] of the trees that pass `keep`. */
  const listTrees = (keep: (id: number) => boolean) =>
    [...worldBodies.keys()].filter(keep).map((id): [number, TreeBody] => [id, getBody(id)!]);
  const simulation = createFellingSimulation(getBody, deriveSeed(world.seed, "felling"), (id) => {
    onRemoved(id);
    worldBodies.delete(id);
    matureBodies.delete(id);
  });
  const isStanding = (id: number) => worldBodies.has(id) && simulation.getPhase(id) === "standing";
  const fell = (id: number, rate = 1) => {
    if (!worldBodies.has(id) || !simulation.fell(id, rate)) return false;
    onFelled(id);
    return true;
  };

  /** Fells the standing tree whose crown is closest to the view centre (scripted shots). */
  const fellNearest = () => {
    const standing = listTrees((id) => isStanding(id) && canFell(id));
    const distance = ([, tree]: [number, TreeBody]) => {
      const crown = getCrownOnScreen(project, tree);
      return DMath.hypot(crown.x - camera.viewportWidth / 2, crown.y - camera.viewportHeight / 2);
    };
    const nearest = standing.sort((a, b) => distance(a) - distance(b))[0];
    if (nearest) fell(nearest[0]);
  };

  /** Trees placed in the map editor become choppable like the world's. */
  const addTrees = (ids: readonly number[]) => {
    for (const id of ids) {
      const body = getChoppableTree(world, id);
      const mature = getChoppableTree(world, id, true);
      if (!body || !mature) continue;
      worldBodies.set(id, body);
      matureBodies.set(id, mature);
    }
  };

  /** Removed standing trees (map editor) can no longer be picked; felled ones finish falling. */
  const removeTrees = (ids: readonly number[], finishFalling = true) => {
    for (const id of ids) {
      if (finishFalling && !isStanding(id)) continue;
      if (!finishFalling) simulation.remove(id);
      worldBodies.delete(id);
      matureBodies.delete(id);
    }
  };

  return {
    saveState: simulation.saveState,
    loadState: (saved: ReturnType<typeof simulation.saveState>) => {
      simulation.loadState(saved);
    },
    addTrees,
    countStumps: simulation.countStumps,
    fell,
    fellNearest,
    isStanding,
    getPhase: (id: number) => worldBodies.has(id) ? simulation.getPhase(id) : "removed" as const,
    getWorkProgress: (id: number) => worldBodies.has(id) ? simulation.getWorkProgress(id) : undefined,
    removeTrees,
    /** Absolute island time (the settlement's tick clock on a played island): falls, leaves and removals. */
    advance: simulation.advance,
    /** The audited fall-direction stream (the settlement's random audit records its draws). */
    random: simulation.random,
    /** Frame-rate leaves and fall poses between two ticks (drawing only; the ticks own the felling). */
    animate: (deltaSeconds: number, lead: number) => {
      simulation.animate(deltaSeconds, lead);
      return simulation.frame;
    },
    /** Islands without a settlement: the render clock drives the felling and its leaves. */
    update: (time: number) => {
      simulation.update(time);
      return simulation.frame;
    }
  };
};
