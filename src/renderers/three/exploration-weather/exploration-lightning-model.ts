/**
 * One presentation lightning event coordinates the bolt shape, cloud illumination, screen flash,
 * optional world light and the positional thunder request. Timing and variation use the injected
 * presentation clock and this module's own PRNG; the weather schedule, simulation time, damage,
 * fires and gameplay events are never touched.
 */
import {
  explorationThunderPosition,
  type ExplorationThunderRequest
} from "../../../app/audio/exploration-weather";
import { createPresentationRandom, mixPresentationSeed, PRESENTATION_WEATHER_SEED } from "./presentation-random";

export interface ExplorationLightningStrike extends ExplorationThunderRequest {
  id: number;
  seed: number;
  x: number;
  y: number;
  z: number;
}

export interface ExplorationLightningFrame {
  active: boolean;
  cloudFlash: number;
  flash: number;
  strike: ExplorationLightningStrike | null;
  strikeId: number;
  worldLight: number;
}

export interface ExplorationLightningModelOptions {
  maxIntervalSeconds?: number;
  minIntervalSeconds?: number;
  reducedFlash?: boolean;
  seed?: number;
  stormThreshold?: number;
}

export interface ExplorationLightningUpdate {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  deltaSeconds: number;
  /** 0..1 rain; the same storm threshold the ordinary presentation uses. */
  rain: number;
  timeSeconds: number;
  /** Camera yaw in the exploration convention (0 faces +Z, positive turns to +X). */
  yaw?: number;
}

export interface ExplorationLightningModel {
  dispose: () => void;
  reset: () => void;
  update: (input: ExplorationLightningUpdate) => ExplorationLightningFrame;
}

const NORMAL_FLASH_SECONDS = 0.42;
const REDUCED_FLASH_SECONDS = 0.24;
const NORMAL_FLASH_PEAK = 1;
const REDUCED_FLASH_PEAK = 0.28;

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

/**
 * Fixed-step visual envelope, separate from the schedule. Reduced flash keeps the same strike and
 * sound pairing but caps brightness and the secondary world/cloud pulses.
 */
const envelope = (age: number, reduced: boolean) => {
  if (reduced) {
    const decay = Math.max(0, 1 - age / REDUCED_FLASH_SECONDS);
    return {
      cloudFlash: decay * REDUCED_FLASH_PEAK * 0.32,
      flash: decay * REDUCED_FLASH_PEAK,
      worldLight: decay * REDUCED_FLASH_PEAK * 0.16
    };
  }
  if (age > NORMAL_FLASH_SECONDS) return { cloudFlash: 0, flash: 0, worldLight: 0 };
  const decay = Math.max(0, 1 - age / NORMAL_FLASH_SECONDS);
  const flicker = 0.82 + 0.18 * Math.sin(age * 70);
  const flash = decay * flicker * NORMAL_FLASH_PEAK;
  return { cloudFlash: flash * 0.8, flash, worldLight: flash * 0.32 };
};

export const createExplorationLightningModel = (
  options: ExplorationLightningModelOptions = {}
): ExplorationLightningModel => {
  const minInterval = Math.max(1, options.minIntervalSeconds ?? 8);
  const maxInterval = Math.max(minInterval, options.maxIntervalSeconds ?? 22);
  const stormThreshold = clamp01(options.stormThreshold ?? 0.55);
  const reduced = options.reducedFlash ?? false;
  const random = createPresentationRandom(
    mixPresentationSeed(options.seed ?? PRESENTATION_WEATHER_SEED, 0x11a7)
  );
  let nextStrikeAt = -1;
  let stormActive = false;
  let strikeAge: number | null = null;
  let strikeId = 0;
  let flash = 0;
  let cloudFlash = 0;
  let worldLight = 0;
  let disposed = false;
  const frame: ExplorationLightningFrame = {
    active: false, cloudFlash: 0, flash: 0, strike: null, strikeId: 0, worldLight: 0
  };

  const schedule = (timeSeconds: number, immediateMinimum: number) => {
    const minimum = Math.min(maxInterval, Math.max(1, immediateMinimum));
    nextStrikeAt = timeSeconds + minimum + random() * (maxInterval - minimum);
  };

  const reset = () => {
    nextStrikeAt = -1;
    stormActive = false;
    strikeAge = null;
    strikeId = 0;
    flash = 0;
    cloudFlash = 0;
    worldLight = 0;
    frame.active = false;
    frame.strike = null;
    frame.strikeId = 0;
  };

  const update = (input: ExplorationLightningUpdate): ExplorationLightningFrame => {
    if (disposed) {
      frame.active = false;
      frame.strike = null;
      frame.flash = 0;
      frame.cloudFlash = 0;
      frame.worldLight = 0;
      return frame;
    }
    const timeSeconds = finiteOr(input.timeSeconds, 0);
    const delta = Math.max(0, finiteOr(input.deltaSeconds, 0));
    const rain = clamp01(input.rain);
    const active = rain > stormThreshold;
    const cameraX = finiteOr(input.cameraX, 0);
    const cameraY = finiteOr(input.cameraY, 0);
    const cameraZ = finiteOr(input.cameraZ, 0);
    const yaw = finiteOr(input.yaw ?? 0, 0);
    let strike: ExplorationLightningStrike | null = null;

    if (active && !stormActive) schedule(timeSeconds, 3);
    stormActive = active;
    if (active && nextStrikeAt < 0) schedule(timeSeconds, 3);
    if (active && timeSeconds >= nextStrikeAt) {
      const angle = yaw + (random() - 0.5) * 2.4;
      const distance = 16 + random() * 20;
      const x = cameraX + Math.sin(angle) * distance;
      const z = cameraZ + Math.cos(angle) * distance;
      const y = cameraY + 22 + random() * 12;
      const position = explorationThunderPosition(x - cameraX, z - cameraZ, yaw);
      strikeId++;
      strike = {
        delaySeconds: position.delaySeconds,
        distance: position.distance,
        id: strikeId,
        intensity: reduced ? 0.55 : 1,
        pan: position.pan,
        seed: Math.floor(random() * 0x100000000) >>> 0,
        x,
        y,
        z
      };
      strikeAge = 0;
      flash = reduced ? REDUCED_FLASH_PEAK : NORMAL_FLASH_PEAK;
      cloudFlash = reduced ? REDUCED_FLASH_PEAK * 0.32 : 0.8;
      worldLight = reduced ? REDUCED_FLASH_PEAK * 0.16 : 0.32;
      schedule(timeSeconds, minInterval);
    } else if (strikeAge !== null) {
      strikeAge += delta;
      const values = envelope(strikeAge, reduced);
      flash = values.flash;
      cloudFlash = values.cloudFlash;
      worldLight = values.worldLight;
      if (strikeAge > (reduced ? REDUCED_FLASH_SECONDS : NORMAL_FLASH_SECONDS)) strikeAge = null;
    } else {
      flash = 0;
      cloudFlash = 0;
      worldLight = 0;
    }

    frame.active = active;
    frame.cloudFlash = cloudFlash;
    frame.flash = flash;
    frame.strike = strike;
    frame.strikeId = strikeId;
    frame.worldLight = worldLight;
    return frame;
  };

  return {
    dispose: () => {
      disposed = true;
      reset();
    },
    reset,
    update
  };
};
