import { createRandom, deriveSeed } from "../../../shared/world/rng";
import { renderCrowCall, renderGullCall, renderSongbirdCall, renderSwiftCall } from "./bird-calls";
import { renderCrickets } from "./cricket-sounds";
import { type SynthInput,trimTail } from "./dsp";
import { renderBroadleafRustle, renderFrondClatter, renderNeedleHiss } from "./foliage-sounds";
import { renderDeerBark, renderElkBugle, renderGrassRustle } from "./mammal-calls";
import { renderRainHiss, renderRainOnLeaves } from "./rain-sounds";
import { renderSnowfall } from "./snow-sounds";
import { renderRiver, renderSeaBreakers, renderSeaSwell } from "./water-sounds";

/** Sample rate of the synthesised buffers (the audio context resamples them). */
export const SYNTH_RATE = 32000;

type Recipe = (input: SynthInput) => Float32Array;

/** Continuous beds, each played as one long-lived looping source. */
const LOOP_RECIPES = {
  broadleaf: renderBroadleafRustle,
  crickets: renderCrickets,
  palm: renderFrondClatter,
  pine: renderNeedleHiss,
  rain: renderRainHiss,
  rainLeaves: renderRainOnLeaves,
  river: renderRiver,
  seaBreakers: renderSeaBreakers,
  seaSwell: renderSeaSwell,
  snowfall: renderSnowfall
} satisfies Record<string, Recipe>;

export type LoopLayer = keyof typeof LOOP_RECIPES;

export const LOOP_LAYERS = Object.keys(LOOP_RECIPES) as LoopLayer[];

/** One-shot creature calls; several variants each, picked at random and re-pitched per play. */
const CALL_RECIPES = {
  crow: renderCrowCall,
  deer: renderDeerBark,
  elk: renderElkBugle,
  gull: renderGullCall,
  rabbit: renderGrassRustle,
  songbird: renderSongbirdCall,
  swift: renderSwiftCall
} satisfies Record<string, Recipe>;

export type CreatureSoundKind = keyof typeof CALL_RECIPES;

export const CREATURE_SOUND_KINDS = Object.keys(CALL_RECIPES) as CreatureSoundKind[];

/** Songbirds sing most (forest bed and birds in view), so they get the widest repertoire. */
const getCallVariantCount = (kind: CreatureSoundKind) => (kind === "songbird" ? 18 : 4);

const createInput = (label: string, rate: number): SynthInput => ({
  random: createRandom(deriveSeed(0x51ad, label)),
  rate
});

export const renderLoop = (layer: LoopLayer, rate = SYNTH_RATE) =>
  LOOP_RECIPES[layer](createInput(layer, rate));

/** One call of a creature (its first variant): script sound cues and the editor preview. */
export const renderCall = (kind: CreatureSoundKind, rate = SYNTH_RATE) =>
  trimTail(CALL_RECIPES[kind](createInput(kind, rate)), rate);

export const renderCallVariants = (kind: CreatureSoundKind, rate = SYNTH_RATE) => {
  const input = createInput(kind, rate);
  return Array.from({ length: getCallVariantCount(kind) }, () =>
    trimTail(CALL_RECIPES[kind](input), rate)
  );
};
