import { SHIP_DECK_HORSE_WORLD, SHIP_DECK_PERSON_WORLD } from "../../src/render-common/ships/ship-deck-layout";
import { SAILING_SHIP_OVERALL_LENGTH } from "../../src/render-common/ships/ship-dimensions";
import {
  ADVENTURE_LANDING_PHASES, ADVENTURE_SHIP_PHASES
} from "../../src/shared/settlement/settlement-adventure-landing";
import type { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";

/** A body seen from above: a capsule along its heading (a person's is a circle). */
export interface LandingBody { x: number; z: number; yaw: number; mounted?: boolean }

const PERSON_RADIUS = SHIP_DECK_PERSON_WORLD.depth / 2;
const HORSE_RADIUS = SHIP_DECK_HORSE_WORLD.width / 2;
/** Half the length of a horse's capsule core (its length less the rounded ends). */
const HORSE_CORE = SHIP_DECK_HORSE_WORLD.depth / 2 - HORSE_RADIUS;

const core = (body: LandingBody) => {
  const half = body.mounted ? HORSE_CORE : 0, dx = Math.sin(body.yaw) * half, dz = Math.cos(body.yaw) * half;
  return { from: { x: body.x - dx, z: body.z - dz }, to: { x: body.x + dx, z: body.z + dz } };
};

type Point = { x: number; z: number };
const pointToSegment = (point: Point, from: Point, to: Point) => {
  const dx = to.x - from.x, dz = to.z - from.z, length = dx * dx + dz * dz;
  const share = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / length)) : 0;
  return Math.hypot(point.x - from.x - dx * share, point.z - from.z - dz * share);
};

type Simulation = ReturnType<typeof createSettlementSimulation>;
/** Horses count as landing within half the ship's length of it, or this near the gangway foot. */
const SHIP_REACH = SAILING_SHIP_OVERALL_LENGTH / 2;
const BEACH_REACH = 3;

/** Whether any of `ids` is still aboard the landing ship or on its gangway. */
export const stillLanding = (simulation: Simulation, ids: ReadonlySet<number>) => simulation.frames()
  .some(actor => ids.has(actor.uid) && ADVENTURE_SHIP_PHASES.includes(actor.phase));

/** The visible soldiers of `ids` aboard or on the gangway, and the horses standing on deck. */
export const landingBodies = (simulation: Simulation, ids: ReadonlySet<number>): LandingBody[] => {
  const landing = simulation.adventure()?.landing;
  const near = (point: { x: number; z: number }) => Boolean(landing) &&
    (Math.hypot(point.x - landing!.water.x, point.z - landing!.water.z) < SHIP_REACH ||
    Math.hypot(point.x - landing!.shore.x, point.z - landing!.shore.z) < BEACH_REACH);
  return [
    ...simulation.frames().filter(actor => ids.has(actor.uid) && actor.visible &&
      ADVENTURE_LANDING_PHASES.includes(actor.phase)),
    ...simulation.horseFrames().filter(horse => horse.visible !== false && near(horse))
      .map(horse => ({ mounted: true, x: horse.x, yaw: horse.heading, z: horse.z }))
  ];
};

/** Gap between two bodies (tiles; negative when they overlap): riders as horse-sized capsules. */
export const landingClearance = (a: LandingBody, b: LandingBody) => {
  const first = core(a), second = core(b);
  const distance = Math.min(pointToSegment(first.from, second.from, second.to),
    pointToSegment(first.to, second.from, second.to), pointToSegment(second.from, first.from, first.to),
    pointToSegment(second.to, first.from, first.to));
  return distance - (a.mounted ? HORSE_RADIUS : PERSON_RADIUS) - (b.mounted ? HORSE_RADIUS : PERSON_RADIUS);
};
