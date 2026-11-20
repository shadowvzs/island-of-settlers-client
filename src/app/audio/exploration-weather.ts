/**
 * EXPLORE-01F positional thunder. This owner is separate from the ordinary soundscape: it borrows
 * the existing AudioContext/environment bus, reads the current master/environment levels on every
 * strike and never writes a setting. It creates at most a few short voices, reuses one noise buffer
 * and leaves both the context and the destination untouched on dispose.
 */
const THUNDER_SEED = 0x51f0a7;

/** Presentation-only xorshift; thunder variation never consumes gameplay or sim RNG. */
const createPresentationRandom = (seed: number) => {
  let state = (seed >>> 0) || THUNDER_SEED;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
};

export interface ExplorationThunderRequest {
  distance: number;
  /** Scheduled after the visual flash, according to distance. */
  delaySeconds: number;
  /** 0..1 flash strength, already reduced when reduced flash is requested. */
  intensity: number;
  /** -1 left .. 1 right, derived from the strike relative to the camera yaw. */
  pan: number;
}

export interface ExplorationThunderAudioStats {
  bufferReady: boolean;
  disposed: boolean;
  maxVoices: number;
  played: number;
  rejected: number;
  voices: number;
}

export interface ExplorationWeatherAudioSink {
  dispose: () => void;
  play: (request: ExplorationThunderRequest) => boolean;
  stats: () => ExplorationThunderAudioStats;
}

export interface ExplorationThunderAudioOptions {
  /** Borrowed; dispose never closes it because the soundscape still owns ordinary audio. */
  context: AudioContext | null;
  /** Environment bus of the existing soundscape; defaults to `context.destination`. */
  destination?: AudioNode | null;
  /** Existing sound on/off preference; checked on every strike. */
  enabled?: () => boolean;
  /** Read on each strike; the audio settings remain the source of truth. */
  levels?: () => { master: number; environment: number };
  maxVoices?: number;
  seed?: number;
}

const MAX_THUNDER_VOICES = 3;
const THUNDER_SECONDS = 2.2;
const SPEED_OF_SOUND = 343;

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * Distance delay and stereo pan for a strike. The flash is immediate; only the sound waits.
 * A strike 34 m away is about 0.1 s late, a 150 m strike about 0.46 s (capped).
 */
export const explorationThunderPosition = (
  relativeX: number,
  relativeZ: number,
  yaw: number
): { delaySeconds: number; distance: number; pan: number } => {
  const x = Number.isFinite(relativeX) ? relativeX : 0;
  const z = Number.isFinite(relativeZ) ? relativeZ : 0;
  const heading = Number.isFinite(yaw) ? yaw : 0;
  const distance = Math.hypot(x, z);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  const pan = distance < 1e-4
    ? 0
    : clamp01((x * rightX + z * rightZ) / distance * 0.5 + 0.5) * 2 - 1;
  return {
    delaySeconds: Math.min(0.45, 0.02 + distance / SPEED_OF_SOUND),
    distance,
    pan
  };
};

interface ParamLike {
  setValueAtTime: (value: number, time: number) => unknown;
  linearRampToValueAtTime: (value: number, time: number) => unknown;
  exponentialRampToValueAtTime: (value: number, time: number) => unknown;
  value: number;
}

interface NodeLike {
  connect: (destination: NodeLike) => unknown;
  disconnect: () => void;
}

interface FilterLike extends NodeLike {
  frequency: ParamLike;
  Q: ParamLike;
  type: string;
}

interface GainLike extends NodeLike {
  gain: ParamLike;
}

interface PannerLike extends NodeLike {
  pan: ParamLike;
}

interface SourceLike extends NodeLike {
  buffer: BufferLike | null;
  onended: (() => void) | null;
  playbackRate: ParamLike;
  start: (when?: number) => void;
  stop: (when?: number) => void;
}

interface BufferLike {
  getChannelData: (channel: number) => Float32Array;
}

interface ContextLike {
  currentTime: number;
  destination: NodeLike;
  sampleRate: number;
  state: string;
  createBiquadFilter: () => FilterLike;
  createBuffer: (channels: number, length: number, sampleRate: number) => BufferLike;
  createBufferSource: () => SourceLike;
  createGain: () => GainLike;
  createStereoPanner: () => PannerLike;
  resume?: () => Promise<void>;
}

interface Voice {
  ended: boolean;
  filter: FilterLike;
  gain: GainLike;
  panner: PannerLike;
  source: SourceLike;
}

/**
 * Bounded thunder owner. A strike is rejected rather than stealing an older voice when the cap is
 * reached; late voices are cleaned through `onended`. No buffer is allocated until the first strike,
 * so merely entering the feature does not create audio resources.
 */
export const createExplorationThunderAudio = (
  options: ExplorationThunderAudioOptions
): ExplorationWeatherAudioSink => {
  const context = options.context as unknown as ContextLike | null;
  const destination = (options.destination ?? context?.destination ?? null) as unknown as NodeLike | null;
  const maxVoices = Math.max(0, Math.min(MAX_THUNDER_VOICES,
    Math.floor(options.maxVoices ?? MAX_THUNDER_VOICES)));
  const random = createPresentationRandom(options.seed ?? THUNDER_SEED);
  const voices: Voice[] = [];
  let buffer: BufferLike | null = null;
  let disposed = false;
  let played = 0;
  let rejected = 0;

  const ensureBuffer = () => {
    if (buffer || !context || !(context.sampleRate > 0)) return buffer;
    const length = Math.max(1, Math.floor(context.sampleRate * THUNDER_SECONDS));
    buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      const t = index / Math.max(1, context.sampleRate);
      samples[index] = (random() * 2 - 1) * Math.exp(-t * 1.7) * (0.7 + Math.sin(t * 19) * 0.3);
    }
    return buffer;
  };

  const cleanup = (voice: Voice) => {
    if (voice.ended) return;
    voice.ended = true;
    try {
      voice.source.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
      voice.panner.disconnect();
    } catch {
      // A closed context may already have disconnected the nodes.
    }
    const index = voices.indexOf(voice);
    if (index >= 0) voices.splice(index, 1);
  };

  const reject = () => {
    rejected++;
    return false;
  };

  const play = (request: ExplorationThunderRequest): boolean => {
    if (disposed || maxVoices === 0 || !context || !destination) return reject();
    if (options.enabled && !options.enabled()) return reject();
    if (context.state === "closed") return reject();
    if (voices.length >= maxVoices) return reject();
    const levels = options.levels?.() ?? { environment: 1, master: 1 };
    const volume = clamp01(levels.master) * clamp01(levels.environment) *
      clamp01(request.intensity);
    if (volume <= 0.001) return reject();
    const audioBuffer = ensureBuffer();
    if (!audioBuffer) return reject();

    let voice: Voice | null = null;
    try {
      if (context.state === "suspended") void context.resume?.().catch(() => undefined);
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      source.buffer = audioBuffer;
      source.playbackRate.value = 0.9 + random() * 0.2;
      filter.type = "lowpass";
      filter.frequency.value = 210 + clamp01(request.intensity) * 60;
      filter.Q.value = 0.7;
      panner.pan.value = Math.max(-1, Math.min(1, request.pan));
      voice = { ended: false, filter, gain, panner, source };
      const startAt = context.currentTime + Math.max(0.02, request.delaySeconds);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.55 * volume, startAt + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + THUNDER_SECONDS);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(destination);
      source.onended = () => {
        if (voice) cleanup(voice);
      };
      source.start(startAt);
      source.stop(startAt + THUNDER_SECONDS);
    } catch {
      if (voice) cleanup(voice);
      return reject();
    }
    voices.push(voice);
    played++;
    return true;
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const voice of voices.slice()) {
        try {
          voice.source.stop();
        } catch {
          // The scheduled stop may already have fired.
        }
        cleanup(voice);
      }
      voices.length = 0;
      buffer = null;
    },
    play,
    stats: () => ({
      bufferReady: buffer !== null,
      disposed,
      maxVoices,
      played,
      rejected,
      voices: voices.length
    })
  };
};
