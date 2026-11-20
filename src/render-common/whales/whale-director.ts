import { createRandom, deriveSeed, pickWeighted, randomBetween } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";
import { createRippleFrame, type RippleFrame } from "../critters/sim/critter-pool";
import { createRipples } from "../critters/sim/critter-ripples";
import type { Vec3 } from "../props/mesh-builder";
import {
  EVENT_TRAVEL_SCALE,
  getEventDuration,
  getEventTimeScale,
  getEventTrack,
  getEventTravel,
  sampleEventTrack,
  WHALE_EVENTS,
  type WhaleChannels,
  type WhaleEventKind
} from "./whale-events";
import { createWhalePose, toWorld, updateWhaleBasis, type WhalePose } from "./whale-pose";
import { findWhaleSite, getViewHeading, type WhaleSite, type WhaleView } from "./whale-site";
import { sampleProfile, WHALE_SHAPES, type WhaleSpecies } from "./whale-species";
import { createSplashTracker, type SplashSink } from "./whale-splashes";
import { createSprayFrame, createWhaleSpray, type SprayFrame } from "./whale-spray";
import { createWhaleWater } from "./whale-water";

/**
 * Rare decorative whale surfacings (render only, no gameplay): about every five minutes, when
 * the camera looks at deep visible sea, one humpback or orca rolls, breaches, slaps its flukes or
 * blows there. One animated whale at a time; between events nothing is simulated or drawn.
 */
export interface WhaleFrame {
  /** An event is running: the pose is valid. */
  active: boolean;
  pose: WhalePose;
  ripples: RippleFrame;
  /** The dark shape of the submerged body seen from above (0 opacity: none). */
  shadow: { length: number; opacity: number; x: number; y: number; yaw: number; z: number };
  spray: SprayFrame;
}

export interface WhaleDirectorOptions {
  /** Ring pool size. */
  rings: number;
  /** Spray particle pool size (the emitters scale their counts to it). */
  spray: number;
}

/** Seconds between events and before the first one; the retry while no deep sea is in view. */
const INTERVAL = [240, 360] as const;
const FIRST = [90, 300] as const;
const RETRY = 6;
/** Seconds after the last emission until every particle and ring has faded (idle again). */
const SETTLE = 18;
const MAX_STEP = 0.1;
/** Fluke strokes per second (humpback; the orca's time scale speeds it up). */
const STROKE_RATE = 0.38;
const KIND_WEIGHTS = [0.3, 0.2, 0.2, 0.3];
const SPECIES_WEIGHTS = [0.6, 0.4];
/** Blow (spout) height in world units. */
const BLOW_HEIGHT = [2.4, 1.0];
/** Foam washing around a back at the surface: interval (s) and radius (body lengths). */
const WASH = { every: 0.6, radius: 0.12, reach: 0.06 } as const;
/** Largest splash ring (body lengths). */
const RING_LIMIT = 0.6;
/** Rest points of the blowhole and of the back where the wash foams (per species). */
const BLOWHOLES: readonly Vec3[] = WHALE_SHAPES.map((shape) =>
  [0.5 - shape.blowhole, sampleProfile(shape.top, shape.blowhole), 0]);
const BACKS: readonly Vec3[] = WHALE_SHAPES.map((shape) => [0.1, sampleProfile(shape.top, 0.4), 0]);

/** Tail slaps face the flukes to the viewer; everything else passes broadside. */
const faceAway = (kind: WhaleEventKind) => kind === "tailSlap";

export const createWhaleDirector = (world: WorldData, options: WhaleDirectorOptions) => {
  const water = createWhaleWater(world);
  const random = createRandom(deriveSeed(world.seed, "whales"));
  const spray = createWhaleSpray(options.spray);
  const ripples = createRipples(options.rings, water);
  const splashes = createSplashTracker();
  const channels = {} as WhaleChannels;
  const site: WhaleSite = { x: 0, yaw: 0, z: 0 };
  const point = { x: 0, y: 0, z: 0 };
  const frame: WhaleFrame = {
    active: false,
    pose: createWhalePose(),
    ripples: createRippleFrame(options.rings),
    shadow: { length: 0, opacity: 0, x: 0, y: 0, yaw: 0, z: 0 },
    spray: createSprayFrame(options.spray)
  };
  const event = { blow: 0, kind: "roll" as WhaleEventKind, start: 0, wash: 0 };
  let clock = 0;
  let lastTime = -1;
  let enabled = true;
  let nextAt = randomBetween(random, ...FIRST);
  let busyUntil = -1;

  const settle = () => (busyUntil = clock + SETTLE);

  const sink: SplashSink = {
    splash: (x, z, strength) => {
      const surface = water.water(x, z);
      spray.splash(x, surface, z, strength, random);
      ripples.emit(x, z, Math.min(RING_LIMIT * WHALE_SHAPES[frame.pose.species]!.length, strength * 1.6));
      settle();
    },
    stream: (x, y, z, speed) => {
      spray.stream(x, y, z, speed, random);
      settle();
    }
  };

  const start = (kind: WhaleEventKind, species: WhaleSpecies, at: WhaleSite) => {
    Object.assign(site, at);
    Object.assign(event, { blow: 0, kind, start: clock, wash: 0 });
    frame.pose.species = species;
    frame.pose.strokePhase = random() * Math.PI * 2;
    frame.active = true;
    splashes.reset();
    settle();
  };

  const finish = () => {
    frame.active = false;
    frame.shadow.opacity = 0;
    nextAt = clock + randomBetween(random, ...INTERVAL);
  };

  const trySpawn = (view: WhaleView) => {
    const kind = WHALE_EVENTS[pickWeighted(KIND_WEIGHTS, random)]!;
    const species = pickWeighted(SPECIES_WEIGHTS, random) as WhaleSpecies;
    const { length } = WHALE_SHAPES[species]!;
    const travel = getEventTravel(kind) * length;
    if (findWhaleSite(water, view, world.seaLevel, { away: faceAway(kind), length, travel }, random, site)) {
      start(kind, species, site);
      return;
    }
    nextAt = clock + RETRY;
  };

  const placePose = (pose: WhalePose, seconds: number, step: number) => {
    const { length } = WHALE_SHAPES[pose.species]!;
    sampleEventTrack(getEventTrack(event.kind), seconds, channels);
    const travel = channels.travel * EVENT_TRAVEL_SCALE[event.kind] * length;
    pose.x = site.x + Math.cos(site.yaw) * travel;
    pose.z = site.z - Math.sin(site.yaw) * travel;
    pose.y = water.water(pose.x, pose.z) + channels.depth * length;
    pose.yaw = site.yaw;
    pose.pitch = channels.pitch;
    pose.roll = channels.roll;
    pose.arch = channels.arch;
    pose.pectoral = channels.pectoral;
    pose.strokeAmplitude = channels.stroke;
    pose.strokePhase += step * STROKE_RATE * Math.PI * 2 / getEventTimeScale(pose.species);
    updateWhaleBasis(pose);
  };

  const blowAt = (pose: WhalePose) => {
    toWorld(pose, BLOWHOLES[pose.species]!, point);
    spray.blow(point.x, point.y, point.z, BLOW_HEIGHT[pose.species]!, random);
    settle();
  };

  /** White water around a back moving at the surface. */
  const washAt = (pose: WhalePose, step: number) => {
    const shape = WHALE_SHAPES[pose.species]!;
    event.wash -= step;
    if (event.wash > 0) return;
    toWorld(pose, BACKS[pose.species]!, point);
    const surface = water.water(point.x, point.z);
    if (Math.abs(point.y - surface) > WASH.reach * shape.length) return;
    spray.foam(point.x, surface, point.z, WASH.radius * shape.length, random);
    event.wash = WASH.every;
    settle();
  };

  const updateShadow = (pose: WhalePose) => {
    const { length } = WHALE_SHAPES[pose.species]!;
    const depth = (pose.y - water.water(pose.x, pose.z)) / length;
    // Fades in rising from the depth, stays faint around a back at the surface, gone in the air.
    const rising = Math.min(1, Math.max(0, (depth + 1.1) / 0.8));
    const submerged = 0.4 + 0.6 * Math.min(1, Math.max(0, -(depth + 0.03) / 0.2));
    const airborne = Math.min(1, Math.max(0, (depth + 0.02) / 0.08));
    Object.assign(frame.shadow, {
      length: length * Math.max(0.35, Math.abs(Math.cos(pose.pitch))),
      opacity: rising * submerged * (1 - airborne) * Math.abs(Math.cos(pose.pitch)),
      x: pose.x, y: water.water(pose.x, pose.z), yaw: pose.yaw, z: pose.z
    });
  };

  const runEvent = (step: number) => {
    const pose = frame.pose;
    const scale = getEventTimeScale(pose.species);
    const seconds = (clock - event.start) / scale;
    if (clock - event.start >= getEventDuration(event.kind, pose.species)) return finish();
    placePose(pose, seconds, step);
    splashes.track(pose, step, water.water, sink);
    const blows = getEventTrack(event.kind).blows;
    while (event.blow < blows.length && seconds >= blows[event.blow]!) {
      blowAt(pose);
      event.blow += 1;
    }
    washAt(pose, step);
    updateShadow(pose);
  };

  let lastView: WhaleView | Pick<WhaleView, "forwardX" | "forwardZ"> = { forwardX: 0, forwardZ: 1 };

  const countSites = (kind: WhaleEventKind, species: WhaleSpecies, scaled: boolean) => {
    const { length } = WHALE_SHAPES[species]!;
    const plan = { away: faceAway(kind), length, travel: getEventTravel(kind, scaled) * length };
    let found = 0;
    for (let attempt = 0; attempt < 10; attempt += 1)
      if (findWhaleSite(water, lastView as WhaleView, world.seaLevel, plan, random, site)) found += 1;
    return found;
  };

  /** Advances to `time` (seconds) with the active camera's view; returns the frame to draw. */
  const update = (time: number, view: WhaleView, windX: number, windZ: number) => {
    lastView = view;
    const step = lastTime < 0 ? 0 : Math.min(MAX_STEP, Math.max(0, time - lastTime));
    lastTime = time;
    clock += step;
    if (frame.active) runEvent(step);
    else if (enabled && clock >= nextAt) trySpawn(view);
    if (clock > busyUntil) {
      frame.spray.count = 0;
      frame.ripples.count = 0;
      return frame;
    }
    spray.step(step, windX, windZ, world.seaLevel);
    ripples.step(step);
    spray.write(frame.spray);
    ripples.write(frame.ripples);
    return frame;
  };

  /** The Critters setting: off ends a running event and drops its water at once. */
  const setEnabled = (value: boolean) => {
    enabled = value;
    if (value) return;
    if (frame.active) finish();
    spray.reset();
    ripples.step(SETTLE);
    busyUntil = -1;
  };

  return {
    /** Development and review tools: start an event now, or move the next one closer. */
    debug: {
      /** The heading the director would give an event in the last view. */
      headingFor: (kind: WhaleEventKind) => getViewHeading(lastView, 1, faceAway(kind)),
      /**
       * Review statistics: of 10 spawn searches in the last view, how many find a site, per event and
       * species, with the authored travel and with the shortened one.
       */
      siteReport: () => {
        const report: Record<string, { authored: number; scaled: number }> = {};
        for (const kind of WHALE_EVENTS) for (const species of [0, 1] as WhaleSpecies[]) {
          report[`${kind}-${species}`] = {
            authored: countSites(kind, species, false),
            scaled: countSites(kind, species, true)
          };
        }
        return report;
      },
      /** World units an event travels (review tools centre it on the shot). */
      travelFor: (kind: WhaleEventKind, species: WhaleSpecies) => getEventTravel(kind) * WHALE_SHAPES[species]!.length,
      /** Ends any event and clears its water (review tools between shots). */
      reset: () => {
        const wasEnabled = enabled;
        setEnabled(false);
        setEnabled(wasEnabled);
      },
      scheduleIn: (seconds: number) => (nextAt = clock + seconds),
      state: () => ({ active: frame.active, clock, kind: event.kind, nextAt, particles: spray.live(),
        species: frame.pose.species }),
      /** Without a heading the whale takes the event's view heading (see headingFor). */
      trigger: (kind: WhaleEventKind, species: WhaleSpecies, at: Omit<WhaleSite, "yaw"> & { yaw?: number }) =>
        start(kind, species, { ...at, yaw: at.yaw ?? getViewHeading(lastView, 1, faceAway(kind)) })
    },
    frame,
    setEnabled,
    update
  };
};

export type WhaleDirector = ReturnType<typeof createWhaleDirector>;
