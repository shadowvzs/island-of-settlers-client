import { describe, expect, it, vi } from "vitest";

import {
  createExplorationThunderAudio,
  explorationThunderPosition
} from "../src/app/audio/exploration-weather";

interface FakeParam {
  value: number;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  setValueAtTime: ReturnType<typeof vi.fn>;
}

const createParam = (): FakeParam => ({
  exponentialRampToValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  setValueAtTime: vi.fn(),
  value: 0
});

const createFakeContext = (state = "running") => {
  const sources: ReturnType<typeof createSource>[] = [];
  const createNode = () => ({
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn()
  });
  const createSource = () => ({
    ...createNode(),
    buffer: null as unknown,
    onended: null as (() => void) | null,
    playbackRate: createParam(),
    start: vi.fn(),
    stop: vi.fn()
  });
  const createFilter = () => ({ ...createNode(), frequency: createParam(), Q: createParam(), type: "" });
  const createGain = () => ({ ...createNode(), gain: createParam() });
  const createPanner = () => ({ ...createNode(), pan: createParam() });
  const context = {
    createBiquadFilter: vi.fn(createFilter),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length)
    })),
    createBufferSource: vi.fn(() => {
      const source = createSource();
      sources.push(source);
      return source;
    }),
    createGain: vi.fn(createGain),
    createStereoPanner: vi.fn(createPanner),
    currentTime: 10,
    destination: createNode(),
    resume: vi.fn(() => Promise.resolve()),
    sampleRate: 100,
    state
  };
  return { context, sources };
};

describe("exploration positional thunder", () => {
  it("reuses one noise buffer, schedules the distance delay and pans the strike", () => {
    const { context, sources } = createFakeContext();
    const audio = createExplorationThunderAudio({
      context: context as unknown as AudioContext,
      levels: () => ({ environment: 0.8, master: 0.5 }),
      maxVoices: 2,
      seed: 4
    });
    expect(audio.play({ delaySeconds: 0.12, distance: 34, intensity: 1, pan: 0.4 })).toBe(true);
    expect(context.createBuffer).toHaveBeenCalledTimes(1);
    expect(sources[0]!.start).toHaveBeenCalledWith(10.12);
    expect(sources[0]!.stop).toHaveBeenCalledWith(12.32);
    expect(context.createGain).toHaveBeenCalledTimes(1);
    const gain = context.createGain.mock.results[0]!.value.gain;
    const target = gain.linearRampToValueAtTime.mock.calls[0]![0] as number;
    expect(target).toBeCloseTo(0.22);
    const panner = context.createStereoPanner.mock.results[0]!.value.pan;
    expect(panner.value).toBeCloseTo(0.4);
    expect(audio.play({ delaySeconds: 0.1, distance: 34, intensity: 0.5, pan: -0.2 }))
      .toBe(true);
    expect(context.createBuffer).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it("caps active voices and rejects rather than stealing an older thunder", () => {
    const { context, sources } = createFakeContext();
    const audio = createExplorationThunderAudio({
      context: context as unknown as AudioContext,
      maxVoices: 2
    });
    expect(audio.play({ delaySeconds: 0.1, distance: 30, intensity: 1, pan: 0 })).toBe(true);
    expect(audio.play({ delaySeconds: 0.1, distance: 30, intensity: 1, pan: 0 })).toBe(true);
    expect(audio.play({ delaySeconds: 0.1, distance: 30, intensity: 1, pan: 0 })).toBe(false);
    expect(audio.stats()).toMatchObject({ maxVoices: 2, played: 2, rejected: 1, voices: 2 });
    sources[0]!.onended?.();
    expect(audio.stats().voices).toBe(1);
    expect(audio.play({ delaySeconds: 0.1, distance: 30, intensity: 1, pan: 0 })).toBe(true);
    audio.dispose();
  });

  it("honours master/environment levels and never allocates when sound is off", () => {
    const { context } = createFakeContext();
    const audio = createExplorationThunderAudio({
      context: context as unknown as AudioContext,
      levels: () => ({ environment: 0.5, master: 0 })
    });
    expect(audio.play({ delaySeconds: 0.1, distance: 20, intensity: 1, pan: 0 })).toBe(false);
    expect(context.createBuffer).not.toHaveBeenCalled();
    expect(context.createBufferSource).not.toHaveBeenCalled();
    expect(audio.stats()).toMatchObject({ bufferReady: false, played: 0, rejected: 1 });
    audio.dispose();
  });

  it("honours the existing sound-enabled preference without touching it", () => {
    const { context } = createFakeContext();
    let enabled = false;
    const audio = createExplorationThunderAudio({
      context: context as unknown as AudioContext,
      enabled: () => enabled
    });
    expect(audio.play({ delaySeconds: 0.1, distance: 20, intensity: 1, pan: 0 })).toBe(false);
    expect(context.createBufferSource).not.toHaveBeenCalled();
    enabled = true;
    expect(audio.play({ delaySeconds: 0.1, distance: 20, intensity: 1, pan: 0 })).toBe(true);
    audio.dispose();
  });

  it("stops every voice on dispose without closing the borrowed context", () => {
    const { context, sources } = createFakeContext();
    const close = vi.fn();
    (context as unknown as { close: () => void }).close = close;
    const audio = createExplorationThunderAudio({
      context: context as unknown as AudioContext
    });
    audio.play({ delaySeconds: 0.1, distance: 25, intensity: 1, pan: 0 });
    audio.dispose();
    expect(sources[0]!.stop).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(audio.stats()).toMatchObject({ disposed: true, voices: 0 });
    expect(audio.play({ delaySeconds: 0.1, distance: 25, intensity: 1, pan: 0 })).toBe(false);
  });

  it("uses its own randomness and clamps positional pan", () => {
    const random = vi.spyOn(Math, "random");
    const { context } = createFakeContext();
    const audio = createExplorationThunderAudio({
      context: context as unknown as AudioContext, seed: 8
    });
    audio.play({ delaySeconds: 0.1, distance: 25, intensity: 1, pan: 9 });
    expect(random).not.toHaveBeenCalled();
    expect(explorationThunderPosition(0, 40, 0).pan).toBe(0);
    expect(explorationThunderPosition(40, 0, Math.PI / 2).pan).toBeCloseTo(0);
    audio.dispose();
    random.mockRestore();
  });
});
