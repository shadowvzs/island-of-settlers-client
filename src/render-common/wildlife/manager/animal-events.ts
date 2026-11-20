import { DMath } from "../../../shared/math/deterministic-math";
import { createPointEvent } from "../../helpers";
import { ISLAND_ANIMAL_CAP } from "../population/wildlife-regions";
import { startAnimalDeparture } from "../sim/animal-appearance";
import { perceiveThreat } from "../sim/animal-brain";
import { startCarcass } from "../sim/animal-carcass";
import { startHuntedEscape } from "../sim/animal-hunting";
import { isHuntableAnimal } from "../sim/animal-info";
import { moveOutside } from "../sim/animal-placement";
import type { AnimalManagerState } from "./animal-manager-state";
import type { AnimalModes } from "./animal-modes";
import type { AnimalSpawner } from "./animal-spawner";

/** A kill startles the animals around once (no lasting threat from the carcass). */
const KILL_THREAT = 0.6;
/** A threat wakes the regions within this reach (cells) before the animals perceive it. */
const THREAT_REACH = 18;
/** A hunter's hit startles the animals this close (cells) into an escape. */
const STARTLE_REACH = 9;

/** A threat stimulus: a hunter, a unit, a falling tree. */
export interface ThreatEvent {
  /** 0 a faint noise .. 1 a hunter at close range. */
  intensity: number;
  position: { x: number; z: number };
  /** Optional identity of the source (future hunters). */
  source?: unknown;
}

/**
 * What happens to the animals from outside: threats, kills, hunters' hits, editor removals and
 * relocations, plus the fled / killed point events (birds nearby scatter). Every stimulus first
 * touches the regions around it, so dormant animals there are simulated before they react.
 */
export const createAnimalEvents = (state: AnimalManagerState, modes: AnimalModes, spawner: AnimalSpawner) => {
  const { capacity, context, identity, pool, remember, removed } = state;
  const fled = createPointEvent();
  const killed = createPointEvent();
  context.onFlee = (animal) => {
    fled.emit(pool.x[animal]!, pool.z[animal]!);
  };

  /** A dormant animal (and its region) becomes simulated now; its region holds a while longer. */
  const ensureSimulated = (animal: number) => {
    const region = identity.homeRegion[animal] ?? -1;
    if (region >= 0) modes.touchRegion(region);
  };

  /**
   * Hunter ready threat API: every animal within reach of the stimulus becomes alert or flees
   * (after its reaction delay) along a reachable escape that increases the distance.
   */
  const onThreat = (event: ThreatEvent) => {
    modes.touchCircle(event.position.x, event.position.z, THREAT_REACH);
    for (let animal = 0; animal < capacity; animal += 1) {
      if (!pool.active[animal] || pool.pending[animal]) continue;
      perceiveThreat(context, animal, event.position.x, event.position.z, event.intensity);
    }
  };

  /**
   * An animal died: it falls and stays as a carcass (no longer alive: no AI, collider or herd
   * mate), its region owes a new animal in 5 minutes; the animals around are startled once.
   */
  const killAnimal = (animal: number) => {
    ensureSimulated(animal);
    if (!pool.active[animal]) return;
    pool.pending[animal] = 0; pool.appear[animal] = 1;
    startCarcass(pool, animal);
    remember(animal);
    if (animal < ISLAND_ANIMAL_CAP) state.releaseHome(animal);
    else spawner.onPlacedDeath(pool.species[animal]!, pool.homeX[animal]!, pool.homeZ[animal]!);
    const position = { x: pool.x[animal]!, z: pool.z[animal]! };
    removed.emit(animal);
    killed.emit(position.x, position.z);
    onThreat({ intensity: KILL_THREAT, position });
  };

  /**
   * A hunter's arrow: a wounded animal dies, a sound one runs its wounded escape; the animals
   * close by startle into short escapes of their own. False when the animal is not huntable.
   */
  const hitHuntedAnimal = (id: number, from: { x: number; z: number }) => {
    ensureSimulated(id);
    if (!isHuntableAnimal(pool, id)) return false;
    const x = pool.x[id]!, z = pool.z[id]!;
    modes.touchCircle(x, z, STARTLE_REACH);
    const wounded = pool.huntState[id] === 1 || pool.huntState[id] === 2;
    if (wounded) killAnimal(id);
    else startHuntedEscape(context, id, from);
    for (let other = 0; other < pool.active.length; other++) {
      if (other === id || !pool.active[other] || pool.pending[other] ||
        DMath.hypot(pool.x[other]! - x, pool.z[other]! - z) > STARTLE_REACH) continue;
      if (pool.huntState[other] === 1 || pool.huntState[other] === 2) continue;
      startHuntedEscape(context, other, { x, z }, false);
    }
    return true;
  };

  /**
   * Editor undo immediately releases the living animal, with a short visual departure fade,
   * no carcass and no respawn. False when none of the species lives with its home there.
   */
  const removePlacedAnimal = (species: number, x: number, z: number) => {
    const homeX = Math.fround(x);
    const homeZ = Math.fround(z);
    for (let animal = ISLAND_ANIMAL_CAP; animal < capacity; animal += 1) {
      const isPlaced = pool.homeX[animal] === homeX && pool.homeZ[animal] === homeZ;
      if (pool.active[animal] !== 1 || pool.species[animal] !== species || !isPlaced) continue;
      startAnimalDeparture(pool, animal);
      removed.emit(animal);
      return true;
    }
    return false;
  };

  /**
   * Map editor terrain edits and building plots: the animals inside `isInside` (dormant ones are
   * woken first) move out to the nearest free spot (not killed), then the navigation takes over.
   */
  const relocateFrom = (isInside: (x: number, z: number) => boolean) => {
    modes.wakeInside(isInside);
    for (let animal = 0; animal < capacity; animal += 1) {
      if (pool.active[animal] !== 1 || !isInside(pool.x[animal]!, pool.z[animal]!)) continue;
      moveOutside(context, animal, isInside);
      remember(animal);
    }
  };

  return {
    ensureSimulated,
    hitHuntedAnimal,
    killAnimal,
    onAnimalFled: fled.listen,
    onAnimalKilled: killed.listen,
    onThreat,
    relocateFrom,
    removePlacedAnimal
  };
};
