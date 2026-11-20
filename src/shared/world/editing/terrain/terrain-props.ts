import { DMath } from "../../../math/deterministic-math";
import { placeWaterPlants } from "../../generation/water-plants";
import { sampleSmooth } from "../../grid-geometry";
import { propPhase, quantisePropPosition, quantisePropRotation, quantisePropScale } from "../../prop-quantum";
import { createRandom } from "../../rng";
import { PROP, type WorldData } from "../../world-data";
import { removePropsAt } from "../prop-removal";
import { appendProp } from "../prop-set";
import { planMountainVegetation } from "./mountain-vegetation";
import type { TerrainEditState } from "./terrain-edit-state";
import { getFootprintRatio, isLake, type TerrainStamp } from "./terrain-stamps";

/** A prop a stamp stands (plain values). */
interface StampProp {
  scale: number;
  type: number;
  x: number;
  y: number;
  z: number;
}

/** Boulders of a low mountain stamp: one big boulder (level 1), an outcrop cluster (level 2). */
const planBoulders = (world: WorldData, stamp: TerrainStamp): StampProp[] => {
  if (isLake(stamp) || stamp.level > 2) return [];
  const random = createRandom(stamp.seed);
  const at = (x: number, z: number) => ({ x, y: sampleSmooth(world, world.heights, x, z), z });
  const centre = { scale: 1.3 + random() * 0.3, type: PROP.largeRock, ...at(stamp.x, stamp.z) };
  if (stamp.level !== 2) return [centre];
  const around = Array.from({ length: 3 + Math.floor(random() * 2) }, (_, index) => {
    const angle = (index / 4) * Math.PI * 2 + random() * 0.9;
    const reach = 1.2 + random() * 0.8;
    const type = random() < 0.5 ? PROP.largeRock : PROP.smallRock;
    const point = at(stamp.x + DMath.cos(angle) * reach, stamp.z + DMath.sin(angle) * reach);
    return { scale: 0.9 + random() * 0.4, type, ...point };
  });
  return [centre, ...around];
};

/**
 * Water plants of a lake by the generator's rules (reed and cattail beds from the banks, lily
 * clusters on the calm water): its still water is the lake's own.
 */
const planWaterPlants = (world: WorldData, stamp: TerrainStamp): StampProp[] => {
  if (!isLake(stamp)) return [];
  const stride = world.cellsX + 1;
  const stillWater = Float32Array.from(world.lakeWater ?? [], (lake, vertex) => {
    if (lake !== 1) return 0;
    return getFootprintRatio(stamp, vertex % stride, Math.floor(vertex / stride)) < 1.05 ? 1 : 0;
  });
  if (stillWater.length === 0) return [];
  return placeWaterPlants(world, stamp.seed, { ...world, stillWater }, []);
};

/** What syncStampProps needs of a change. */
export interface StampChangeIds {
  after: TerrainStamp | null;
  beforeId: number | null;
}

/**
 * A stamp's props follow it: the old ones go, the stamp's new ones stand (boulders of mountain
 * levels 1 and 2, a lake's water plants). Returns the props added and removed.
 */
export const syncStampProps = (
  world: WorldData,
  state: TerrainEditState,
  change: StampChangeIds
) => {
  const removed = change.beforeId === null ? [] : (state.stampProps.get(change.beforeId) ?? []);
  removePropsAt(world, removed);
  if (change.beforeId !== null) state.stampProps.delete(change.beforeId);
  const stamp = change.after;
  if (!stamp) return { added: [], removed };
  const random = createRandom(stamp.seed + 1);
  const planned = [...planBoulders(world, stamp), ...planWaterPlants(world, stamp),
    ...planMountainVegetation(world, stamp)];
  const added = planned.map((prop) => {
    const index = appendProp(world.props, {
      ...prop,
      form: 0,
      phase: 0,
      rotation: quantisePropRotation(random() * Math.PI * 2),
      scale: quantisePropScale(prop.scale),
      x: quantisePropPosition(prop.x),
      z: quantisePropPosition(prop.z)
    });
    world.props.phase[index] = propPhase(world.seed, index);
    return index;
  });
  state.stampProps.set(stamp.id, added);
  return { added, removed };
};
