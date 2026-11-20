import type { CameraState } from "../../render-common/camera-state";
import type { CreatureSource } from "./creature-sources";
import type { CallRequest } from "./soundscape-graph";
import { getCreatureCallRate, type SoundConditions } from "./soundscape-mix";
import { CREATURE_SOUND_KINDS, type CreatureSoundKind } from "./synth/sound-bank";
import { getHearingRadius, getViewFootprint, worldToView } from "./world-sound-field";

/** Forest bed: songbird phrases per second at full forest birdsong. */
const FOREST_CALLS_PER_SECOND = 1.4;
/** Forest songbirds sit under the leaf rustle: their loudest call level. */
const FOREST_CALL_LEVEL = 0.2;
/** Creature in view accents: level at the camera target. */
const CREATURE_CALL_LEVEL = 0.32;
/** Creatures a little outside the view are still heard (they are about to appear). */
const VIEW_MARGIN = 1.15;

interface Sighting {
  count: number;
  u: number;
  v: number;
}

/** Number of events of a Poisson process in `seconds` (usually 0 or 1 here). */
export const countEvents = (random: () => number, perSecond: number, seconds: number) => {
  let count = 0;
  let time = -Math.log(1 - random()) / perSecond;
  while (time < seconds && count < 4) {
    count += 1;
    time += -Math.log(1 - random()) / perSecond;
  }
  return count;
};

/** Spatial level and pan of a point in the view (closer to the target: louder). */
export const getSpatialCall = (u: number, v: number, halfU: number, radius: number) => ({
  closeness: 0.35 + 0.65 * Math.exp(-((u * u + v * v) / (radius * radius * 2))),
  pan: Math.max(-1, Math.min(1, u / halfU))
});

const createSightings = () =>
  Object.fromEntries(
    CREATURE_SOUND_KINDS.map((kind) => [kind, { count: 0, u: 0, v: 0 }])
  ) as Record<CreatureSoundKind, Sighting>;

/**
 * Wildlife voices: the forest songbird bed (habitat based, independent of bird entities) and
 * occasional calls of the creatures the systems report in view. Variants are picked without
 * immediate repeats and re-pitched per call, so nothing sounds looped.
 */
export const createWildlifeVoices = (play: (request: CallRequest) => void) => {
  const sources: CreatureSource[] = [];
  const sightings = createSightings();
  const lastVariant: Partial<Record<CreatureSoundKind, number>> = {};
  const bank: Partial<Record<CreatureSoundKind, AudioBuffer[]>> = {};

  const pickBuffer = (kind: CreatureSoundKind) => {
    const variants = bank[kind];
    if (!variants || variants.length === 0) return null;
    let index = Math.floor(Math.random() * variants.length);
    if (index === lastVariant[kind] && variants.length > 1) index = (index + 1) % variants.length;
    lastVariant[kind] = index;
    return variants[index]!;
  };

  const playCall = (kind: CreatureSoundKind, gain: number, pan: number, spread: number) => {
    const buffer = pickBuffer(kind);
    if (!buffer) return;
    play({
      buffer,
      delay: Math.random() * spread,
      gain,
      pan,
      rate: 0.88 + Math.random() * 0.3
    });
  };

  /** Songbird phrases scattered around the forest's side of the stereo field. */
  const updateForest = (seconds: number, gain: number, forestPan: number) => {
    if (gain <= 0.01) return;
    const calls = countEvents(Math.random, FOREST_CALLS_PER_SECOND * gain, seconds);
    for (let call = 0; call < calls; call += 1) {
      const pan = forestPan * 0.6 + (Math.random() * 2 - 1) * 0.7;
      const level = FOREST_CALL_LEVEL * (0.35 + 0.65 * Math.random()) * (0.5 + 0.5 * gain);
      playCall("songbird", level, pan, seconds);
    }
  };

  /** Counts the creatures in view per kind and remembers one random one (reservoir pick). */
  const gatherSightings = (camera: CameraState, halfU: number, halfV: number) => {
    for (const kind of CREATURE_SOUND_KINDS) sightings[kind].count = 0;
    for (const source of sources) {
      source((kind, x, z) => {
        const { u, v } = worldToView(camera, x, z);
        if (Math.abs(u) > halfU * VIEW_MARGIN || Math.abs(v) > halfV * VIEW_MARGIN) return;
        const sighting = sightings[kind];
        sighting.count += 1;
        if (Math.random() * sighting.count > 1) return;
        sighting.u = u;
        sighting.v = v;
      });
    }
  };

  const updateCreatures = (seconds: number, camera: CameraState, conditions: SoundConditions) => {
    const { halfU, halfV } = getViewFootprint(camera);
    const radius = getHearingRadius(halfU, halfV);
    gatherSightings(camera, halfU, halfV);
    for (const kind of CREATURE_SOUND_KINDS) {
      const sighting = sightings[kind];
      const rate = getCreatureCallRate(kind, sighting.count, conditions);
      if (rate <= 0 || countEvents(Math.random, rate, seconds) === 0) continue;
      const { closeness, pan } = getSpatialCall(sighting.u, sighting.v, halfU, radius);
      playCall(kind, CREATURE_CALL_LEVEL * closeness, pan, seconds);
    }
  };

  /** A creature calls right now (an event: a startled deer, a bird taking off). */
  const emit = (camera: CameraState, kind: CreatureSoundKind, x: number, z: number) => {
    const { halfU, halfV } = getViewFootprint(camera);
    const { u, v } = worldToView(camera, x, z);
    if (Math.abs(u) > halfU * 1.5 || Math.abs(v) > halfV * 1.5) return;
    const { closeness, pan } = getSpatialCall(u, v, halfU, getHearingRadius(halfU, halfV));
    playCall(kind, CREATURE_CALL_LEVEL * closeness, pan, 0);
  };

  return {
    addSource: (source: CreatureSource) => sources.push(source),
    emit,
    /** Call variants arrive kind by kind from the synth worker. */
    setCalls: (kind: CreatureSoundKind, buffers: AudioBuffer[]) => {
      bank[kind] = buffers;
    },
    updateCreatures,
    updateForest
  };
};
