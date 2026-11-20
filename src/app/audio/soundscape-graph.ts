import type { LayerMix } from "./soundscape-mix";
import { LOOP_LAYERS, type LoopLayer,SYNTH_RATE } from "./synth/sound-bank";

/** Volume categories, each its own bus under the master (music and effects can join later). */
export type AudioCategory = "environment";

/** Time constants (seconds) of the smoothed parameter changes: no zipper noise, no clicks. */
const GAIN_SMOOTHING = 0.6;
const PAN_SMOOTHING = 0.8;
const VOLUME_SMOOTHING = 0.08;
/** Leaves brighten in gusts: low pass range of the tree layers (Hz). */
const LEAF_DULL = 2200;
const LEAF_BRIGHT = 12000;
const TREE_LAYERS = new Set<LoopLayer>(["broadleaf", "palm", "pine"]);
/** Concurrent one-shot calls; more are dropped (they are ambience, not events). */
const MAX_VOICES = 8;
/** Headroom of the environment bus: many beds can play at once. */
const ENVIRONMENT_HEADROOM = 0.7;

interface LoopChain {
  filter: BiquadFilterNode | null;
  gain: GainNode;
  panner: StereoPannerNode;
  source: AudioBufferSourceNode | null;
}

export interface CallRequest {
  buffer: AudioBuffer;
  gain: number;
  pan: number;
  /** Playback rate: re-pitches a call variant (and changes its pace with it). */
  rate: number;
  /** Delay in seconds from now (calls spread across the update interval). */
  delay: number;
}

const createLoopChain = (context: AudioContext, layer: LoopLayer, output: AudioNode): LoopChain => {
  const gain = context.createGain();
  gain.gain.value = 0;
  const panner = context.createStereoPanner();
  gain.connect(panner).connect(output);
  if (!TREE_LAYERS.has(layer)) return { filter: null, gain, panner, source: null };
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = LEAF_DULL;
  filter.connect(gain);
  return { filter, gain, panner, source: null };
};

/** Smoothly moves an audio parameter towards `value` from now on. */
const glide = (param: AudioParam, value: number, now: number, smoothing: number) =>
  param.setTargetAtTime(value, now, smoothing);

/**
 * The fixed node graph of the soundscape: one long-lived looping chain per bed (source ->
 * [leaf filter] -> gain -> panner), a calls bus, the zoom filter and level, then one bus per
 * volume category, the master and a limiter. Only one-shot calls create nodes, a few per second.
 */
export const createSoundscapeGraph = (context: AudioContext) => {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.connect(context.destination);
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(limiter);
  const buses: Record<AudioCategory, GainNode> = { environment: context.createGain() };
  buses.environment.gain.value = 0;
  buses.environment.connect(master);
  const zoomLevel = context.createGain();
  zoomLevel.gain.value = ENVIRONMENT_HEADROOM;
  zoomLevel.connect(buses.environment);
  const zoomFilter = context.createBiquadFilter();
  zoomFilter.type = "lowpass";
  zoomFilter.frequency.value = 16000;
  zoomFilter.connect(zoomLevel);
  const calls = context.createGain();
  calls.connect(zoomFilter);
  const chains = Object.fromEntries(
    LOOP_LAYERS.map((layer) => [layer, createLoopChain(context, layer, zoomFilter)])
  ) as Record<LoopLayer, LoopChain>;
  let voices = 0;

  /** Starts a bed once its buffer is synthesised, at a random point so beds never align. */
  const setLoop = (layer: LoopLayer, samples: Float32Array) => {
    const chain = chains[layer];
    if (chain.source) return;
    const buffer = toBuffer(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(chain.filter ?? chain.gain);
    source.start(0, Math.random() * buffer.duration);
    chain.source = source;
  };

  const toBuffer = (samples: Float32Array) => {
    const buffer = context.createBuffer(1, samples.length, SYNTH_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return buffer;
  };

  /** Applies a mix: gains and pans glide; leaves swell and brighten with the gust (0..1). */
  const applyMix = (mix: LayerMix, gust: number) => {
    const now = context.currentTime;
    for (const layer of LOOP_LAYERS) {
      const chain = chains[layer];
      const swell = chain.filter ? 0.55 + 0.45 * gust : 1;
      glide(chain.gain.gain, mix.gains[layer] * swell, now, GAIN_SMOOTHING);
      glide(chain.panner.pan, mix.pans[layer], now, PAN_SMOOTHING);
      if (chain.filter)
        glide(chain.filter.frequency, LEAF_DULL + (LEAF_BRIGHT - LEAF_DULL) * gust, now, 0.5);
    }
    glide(zoomLevel.gain, mix.level * ENVIRONMENT_HEADROOM, now, GAIN_SMOOTHING);
    glide(zoomFilter.frequency, mix.lowpass, now, GAIN_SMOOTHING);
  };

  /** Plays a one-shot call; its three nodes are released when it ends. */
  const playCall = (request: CallRequest) => {
    if (voices >= MAX_VOICES) return;
    voices += 1;
    const source = context.createBufferSource();
    source.buffer = request.buffer;
    source.playbackRate.value = request.rate;
    const gain = context.createGain();
    gain.gain.value = request.gain;
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, request.pan));
    source.connect(gain).connect(panner).connect(calls);
    source.onended = () => {
      voices -= 1;
      source.disconnect();
      panner.disconnect();
    };
    source.start(context.currentTime + request.delay);
  };

  return {
    applyMix,
    /** Borrowed environment bus for one-shot presentation effects; never closed by the borrower. */
    environmentBus: () => buses.environment,
    playCall,
    /** Master on / off: a short fade, never a hard cut. */
    setMasterOn: (on: boolean) => glide(master.gain, on ? 1 : 0, context.currentTime, 0.15),
    setLoop,
    setVolume: (category: AudioCategory, volume: number) =>
      glide(buses[category].gain, volume, context.currentTime, VOLUME_SMOOTHING),
    toBuffer
  };
};

export type SoundscapeGraph = ReturnType<typeof createSoundscapeGraph>;
