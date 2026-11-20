import { getPalmHarvestPhase, PALM_HARVEST_TIMING } from "../../../shared/settlement/plantation-harvest";
import { clamp01, lerp3 } from "../../../shared/world/noise";
import type { Vec3 } from "../mesh-builder";
import { COCONUT_FALLEN_GROUPS } from "./coconut-palm-mesh";
import type { VineStage } from "./grapevine-mesh";
import type { RiceStage } from "./rice-mesh";

/**
 * Engine-neutral visual state of the nation drink crops, derived from the simulation's field
 * frames (settlement-field-cycles, docs/archive/dated/temple-and-drinks-2026-10-13.md):
 * - "vine" (Roman) and "rice" (Japanese) are field crops: "growing" (progress 0..1), "ripe",
 *   "stubble" after the harvest;
 * - "hive" (Viking skep) and "palm" (Nubian coconut palm) persist: "growing" is a new hive / young
 *   palm (progress 0..1), "fruiting" a mature one refilling (progress 0..1), "ripe" full / bearing;
 * - optional `harvest` 0..1 while the worker is collecting at the site (bunches picked in turn,
 *   skep lifted with the combs out, palm shaken, nuts dropped and gathered); the simulation derives
 *   it from the harvesting worker's work timer (plantation-harvest.ts).
 */
export interface DrinkCropFrame {
  harvest?: number;
  id: number;
  kind: string;
  progress: number;
  state: string;
  step: number;
  x: number;
  z: number;
}

const ripeness = (frame: DrinkCropFrame, from: number) =>
  frame.state === "ripe" ? 1 : clamp01((frame.progress - from) / (1 - from));
const harvestOf = (frame: DrinkCropFrame) => clamp01(frame.harvest ?? 0);

export interface VineVisual {
  /** Vines (of the three) whose bunches are still hanging, while the harvest proceeds. */
  bunchVines: number;
  bunches: "small" | "full" | null;
  plant: VineStage;
  /** 0 green .. 1 purple. */
  ripeness: number;
}

/**
 * Bare winter wood after planting, budding spurs, the leafy canopy; bunches swell green and turn
 * purple; after the harvest the leaves stay and the bunches are gone.
 */
export const getVineVisual = (frame: DrinkCropFrame): VineVisual => {
  const bunchVines = 3 - Math.floor(harvestOf(frame) * 3.999);
  if (frame.state === "stubble") return { bunchVines, bunches: null, plant: "leafy", ripeness: 0 };
  if (frame.state === "ripe") return { bunchVines, bunches: "full", plant: "leafy", ripeness: 1 };
  if (frame.progress < 0.15) return { bunchVines, bunches: null, plant: "dormant", ripeness: 0 };
  if (frame.progress < 0.35) return { bunchVines, bunches: null, plant: "budding", ripeness: 0 };
  if (frame.progress < 0.5) return { bunchVines, bunches: null, plant: "leafy", ripeness: 0 };
  return { bunchVines, bunches: frame.progress < 0.72 ? "small" : "full", plant: "leafy",
    ripeness: ripeness(frame, 0.72) };
};

export interface RiceVisual {
  stage: RiceStage;
  /** 0 green .. 1 golden (heading panicles turning). */
  ripeness: number;
  /** The paddy is flooded until the harvest (drained, muddy afterwards). */
  flooded: boolean;
}

export const getRiceVisual = (frame: DrinkCropFrame): RiceVisual => {
  if (frame.state === "stubble") return { flooded: false, ripeness: 0, stage: "stubble" };
  if (frame.state === "ripe")
    return { flooded: true, ripeness: 1, stage: harvestOf(frame) > 0.5 ? "stubble" : "ripe" };
  if (frame.progress < 0.25) return { flooded: true, ripeness: 0, stage: "seedling" };
  if (frame.progress < 0.55) return { flooded: true, ripeness: 0, stage: "tillering" };
  return { flooded: true, ripeness: ripeness(frame, 0.75), stage: "heading" };
};

export interface HiveVisual {
  /** Bees flying round the hive (scaled by the High bee budget). */
  bees: number;
  /** Straw ekes under the skep: the colony's growing comb. */
  ekes: number;
  honeyRun: boolean;
  /** The beekeeper has lifted the skep aside and is cutting the combs. */
  open: boolean;
}

export const getHiveVisual = (frame: DrinkCropFrame): HiveVisual => {
  const open = harvestOf(frame) > 0, progress = clamp01(frame.progress);
  if (frame.state === "ripe") return { bees: 10, ekes: 2, honeyRun: !open, open };
  // A new colony first builds its comb in the bare skep; a mature one refills under its ekes.
  if (frame.state === "growing") return { bees: 2 + Math.round(progress * 3), ekes: 0, honeyRun: false, open };
  return { bees: 5 + Math.round(progress * 4), ekes: progress >= 0.5 ? 2 : 1, honeyRun: false, open };
};

export interface PalmVisual {
  /** 0..1 through the nuts' fall from the crown (null when none are falling). */
  drop: number | null;
  /** Groups of nuts lying on the ground, waiting to be gathered. */
  fallen: number;
  fruit: "small" | "full" | null;
  /** Tree growth 0..1 (stages swell into each other). */
  growth: number;
  /** 0 green .. 1 brown. */
  ripeness: number;
  /** Trunk shake amplitude 0..1 while the grower shakes it. */
  shake: number;
}

const NO_HARVEST = { drop: null, fallen: 0, shake: 0 };

/** Shake the trunk, the nuts drop and bounce, then they lie on the ground until gathered. */
const palmHarvest = (harvest: number): Pick<PalmVisual, "drop" | "fallen" | "fruit" | "shake"> => {
  const phase = getPalmHarvestPhase(harvest);
  if (phase === "shake") return { drop: null, fallen: 0, fruit: "full", shake: 0.6 + 0.4 * Math.sin(harvest * 90) ** 2 };
  if (phase === "drop") {
    const drop = (harvest - PALM_HARVEST_TIMING.shake) / (PALM_HARVEST_TIMING.drop - PALM_HARVEST_TIMING.shake);
    return { drop, fallen: 0, fruit: "full", shake: 0.6 * (1 - drop) };
  }
  const gathered = (harvest - PALM_HARVEST_TIMING.drop) / (1 - PALM_HARVEST_TIMING.drop);
  return { drop: null, fallen: COCONUT_FALLEN_GROUPS - Math.floor(gathered * (COCONUT_FALLEN_GROUPS + 0.999)),
    fruit: null, shake: 0 };
};

export const getPalmVisual = (frame: DrinkCropFrame): PalmVisual => {
  if (frame.state === "growing") return { ...NO_HARVEST, fruit: null, growth: clamp01(frame.progress), ripeness: 0 };
  if (frame.state === "ripe")
    return { ...NO_HARVEST, fruit: "full", growth: 1, ripeness: 1, ...(frame.harvest ? palmHarvest(frame.harvest) : {}) };
  if (frame.progress < 0.12) return { ...NO_HARVEST, fruit: null, growth: 1, ripeness: 0 };
  return { ...NO_HARVEST, fruit: frame.progress < 0.45 ? "small" : "full", growth: 1,
    ripeness: ripeness(frame, 0.45) };
};

/** Tint between the unripe and ripe colours of a crop. */
export const ripenTint = (tints: { ripe: Vec3; unripe: Vec3 }, amount: number) =>
  lerp3(tints.unripe, tints.ripe, clamp01(amount));
