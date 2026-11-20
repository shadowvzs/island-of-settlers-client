import { DMath } from "../../../shared/math/deterministic-math";
import { isCarcass } from "../../helpers";
import { isHuntableAnimal } from "../sim/animal-info";
import { dormantAge, evaluateDormantPose } from "../sim/dormant-routine";
import { getHuntValue } from "../wildlife-stages";
import type { AnimalManagerState } from "./animal-manager-state";
import type { AnimalModes } from "./animal-modes";

/** A hunter's possible prey (a living huntable animal) or a lying carcass to collect. */
export interface HuntTarget {
  id: number;
  kind: "carcass" | "wildlife";
  x: number;
  z: number;
}

/**
 * What hunters and inspections see of the animals: the simulation's prey scan (it wakes the
 * regions it searches, so every listed animal is simulated) and read-only snapshots that also
 * count dormant animals at their routine pose, without waking anything.
 */
export const createAnimalHuntTargets = (state: AnimalManagerState, modes: AnimalModes) => {
  const { capacity, context, dormant, identity, pool } = state;

  /** A living, simulated animal: no pending birth, no carcass. */
  const isLiving = (id: number) => pool.active[id] === 1 && !pool.pending[id] && !pool.carcass[id];

  const isEligible = (kind: HuntTarget["kind"], id: number) =>
    kind === "carcass" ? isCarcass(pool, id) : isLiving(id) && isHuntableAnimal(pool, id);

  /** A hunter's scan around `near`: wakes the regions there, then lists in slot order. */
  const listHuntTargets = (kind: HuntTarget["kind"], near: { x: number; z: number }, range: number) => {
    modes.touchCircle(near.x, near.z, range);
    const targets: HuntTarget[] = [];
    for (let id = 0; id < capacity; id += 1) {
      if (!isEligible(kind, id) || DMath.hypot(pool.x[id]! - near.x, pool.z[id]! - near.z) > range) continue;
      targets.push({ id, kind, x: pool.x[id]!, z: pool.z[id]! });
    }
    return targets;
  };

  /** Dormant prey: adults by the closed-form age. */
  const isDormantHuntable = (id: number) =>
    getHuntValue(pool.species[id]!, dormantAge(dormant, id, pool.species[id]!, context.tick)).isHuntable;

  /** Every huntable animal now, dormant ones at their routine pose (read-only: wakes nothing). */
  const listHuntableSnapshot = () => {
    const targets: HuntTarget[] = [];
    for (let id = 0; id < capacity; id += 1) {
      if (isLiving(id) && isHuntableAnimal(pool, id)) {
        targets.push({ id, kind: "wildlife", x: pool.x[id]!, z: pool.z[id]! });
        continue;
      }
      if (!identity.dormant[id] || !isDormantHuntable(id)) continue;
      const pose = evaluateDormantPose(dormant, id, context.tick);
      targets.push({ id, kind: "wildlife", x: pose.x, z: pose.z });
    }
    return targets;
  };

  /** Every living animal now (slot, species, ground position), dormant ones at their routine pose. */
  const listLiving = () => {
    const living: { id: number; species: number; x: number; z: number }[] = [];
    for (let id = 0; id < capacity; id += 1) {
      if (identity.dormant[id]) {
        const pose = evaluateDormantPose(dormant, id, context.tick);
        living.push({ id, species: pool.species[id]!, x: pose.x, z: pose.z });
      } else if (pool.active[id] && !pool.pending[id]) {
        living.push({ id, species: pool.species[id]!, x: pool.x[id]!, z: pool.z[id]! });
      }
    }
    return living;
  };

  return {
    /** Huntable animals on the island now, dormant ones included (read-only). */
    countHuntable: () => listHuntableSnapshot().length,
    isLiving,
    listHuntableSnapshot,
    listHuntTargets,
    listLiving
  };
};
