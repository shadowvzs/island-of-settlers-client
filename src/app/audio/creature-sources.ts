import type { BirdFrame } from "../../render-common/birds/bird-pool";
import type { AnimalFrame } from "../../render-common/wildlife/sim/animal-pool";
import type { CreatureSoundKind } from "./synth/sound-bank";

/** Reports one creature (its kind and ground position) to the soundscape. */
type CreatureVisitor = (kind: CreatureSoundKind, x: number, z: number) => void;

/**
 * A system that has creatures (birds, land animals) lists them when the soundscape asks (a few
 * times a second); the soundscape keeps those in view and lets them call now and then.
 */
export type CreatureSource = (visit: CreatureVisitor) => void;

/** Bird species id (BIRD_SPECIES order: finch, swift, rook, gull) -> its call. */
const BIRD_CALLS: readonly CreatureSoundKind[] = ["songbird", "swift", "crow", "gull"];
/** Land animal species id (wildlife SPECIES order: rabbit, deer, elk) -> its sound. */
const ANIMAL_CALLS: readonly CreatureSoundKind[] = ["rabbit", "deer", "elk"];
/** Creatures over unexplored land (fog of war) stay silent, like they stay hidden. */
const MIN_VISIBILITY = 0.5;

/** The per frame struct of arrays both creature systems share (positions, species, fog). */
type CreatureFrame = Pick<BirdFrame | AnimalFrame, "count" | "species" | "visibility" | "x" | "z">;

/**
 * Adapter for a creature system: `track` passes its frame through (wrap the system's update
 * with it), `source` lists the creatures of the last frame for the soundscape.
 */
const createFrameSoundSource = <Frame extends CreatureFrame>(
  calls: readonly CreatureSoundKind[]
) => {
  let frame: Frame | null = null;
  const source: CreatureSource = (visit) => {
    if (!frame) return;
    for (let slot = 0; slot < frame.count; slot += 1) {
      const kind = calls[frame.species[slot]!];
      if (!kind || frame.visibility[slot]! < MIN_VISIBILITY) continue;
      visit(kind, frame.x[slot]!, frame.z[slot]!);
    }
  };
  const track = (next: Frame) => {
    frame = next;
    return next;
  };
  return { source, track };
};

/** Ambient birds (render-common/birds): finch twitter, swift screech, rook caw, gull cry. */
export const createBirdSoundSource = () => createFrameSoundSource<BirdFrame>(BIRD_CALLS);

/** Land animals (render-common/wildlife): rabbit rustle, rare deer bark, far elk bugle. */
export const createAnimalSoundSource = () => createFrameSoundSource<AnimalFrame>(ANIMAL_CALLS);
