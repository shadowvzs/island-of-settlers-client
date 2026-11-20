import type { PointListener } from "../render-common/helpers";
import { releaseFelledProp } from "../shared/world/build-class";
import type { WorldData } from "../shared/world/world-data";

/** Birds scatter this far (world units) around a felled tree: the axe and the crash. */
export const FELLING_SCARE_RADIUS = 12;
/** Birds scatter this far around an animal breaking into flight. */
export const FLEE_SCARE_RADIUS = 5;
/** Birds scatter this far around a kill. */
export const KILL_SCARE_RADIUS = 8;

interface DisturbanceOptions {
  animals: {
    onAnimalFled: (listener: PointListener) => void;
    onAnimalKilled: (listener: PointListener) => void;
    onTreeFelled: (tree: number) => void;
  };
  birds: { scare: (x: number, z: number, radius: number) => void };
  critters: {
    onCritterKilled: (listener: PointListener) => void;
    scare: (x: number, z: number, radius: number) => void;
  };
  sound: { onTreeFelled: (tree: number) => void };
  world: WorldData;
}

/**
 * Cheap event hooks between the island's living layers: a felled tree alarms the animals,
 * scatters the birds and critters around it and stops its leaves rustling; a fleeing animal
 * flushes the birds and critters near it, a killed animal or food critter (boar, chamois) the
 * birds. Returns the felling hook (`onFelled`).
 */
export const connectIslandDisturbance = ({
  animals,
  birds,
  critters,
  sound,
  world
}: DisturbanceOptions) => {
  animals.onAnimalFled((x, z) => {
    birds.scare(x, z, FLEE_SCARE_RADIUS);
    critters.scare(x, z, FLEE_SCARE_RADIUS);
  });
  const scatterBirdsAtKill = (x: number, z: number) => birds.scare(x, z, KILL_SCARE_RADIUS);
  animals.onAnimalKilled(scatterBirdsAtKill);
  critters.onCritterKilled(scatterBirdsAtKill);
  return (tree: number) => {
    releaseFelledProp(world, tree);
    animals.onTreeFelled(tree);
    sound.onTreeFelled(tree);
    birds.scare(world.props.x[tree]!, world.props.z[tree]!, FELLING_SCARE_RADIUS);
    critters.scare(world.props.x[tree]!, world.props.z[tree]!, FELLING_SCARE_RADIUS);
  };
};
