import type { RoadSegment } from "../shared/settlement/road-types";
import type { SettlementActor } from "../shared/settlement/settlement-types";
import type { WorldData } from "../shared/world/world-data";
import { blendTrailLine } from "./traffic-wear-lines";
import { createRoadWearMask, RoadWearClass } from "./traffic-wear-road-mask";
import { TRAFFIC_WEAR_TUNING } from "./traffic-wear-tuning";

export { TRAFFIC_WEAR_TUNING } from "./traffic-wear-tuning";

const WEAR_MAX = 255;
/**
 * Interleaved RGBA8 texels: R = off-road walker wear, G = handcart wheel wear on dirt and paved
 * roads, B/A = the trail line through the texel (traffic-wear-lines.ts).
 */
export const TRAFFIC_WEAR_CHANNELS = 4;
export const TRAFFIC_WEAR_LINE_CHANNEL = 2;
const GROUND_CHANNEL = 0, RUT_CHANNEL = 1;
/** A texel holding this much wear keeps its line direction against crossing trails. */
const ESTABLISHED = TRAFFIC_WEAR_TUNING.add * 2;

/** Presentation-only traffic wear field (RGBA8). Never saved; rebuilt empty after a load. */
export interface TrafficWearField {
  height: number;
  pixels: Uint8Array;
  revision: number;
  width: number;
}

/** A drawn hand cart: its axle centre (handcart-render-frames.ts), keyed by its carrier. */
export interface TrafficWearCart {
  id: number;
  x: number;
  z: number;
}

type TrafficWearSimulation = {
  frames(): readonly SettlementActor[];
  observeTicks(listener: () => void): () => void;
};

type TrafficWearRoads = {
  readonly revision?: number;
  segments?(): readonly RoadSegment[];
};

interface Trail {
  seen: number;
  x: number;
  z: number;
}

/** A point of a trail's centre line and its heading (radians in the x/z plane). */
interface TrailPoint {
  heading: number;
  x: number;
  z: number;
}

/** What a trail does: a walker treads off-road ground, a cart's two wheels mark a road. */
interface TrailKind {
  channel: number;
  /** Contact points beside the centre line (cells): the walker's line itself, or both wheels. */
  contacts: readonly number[];
  /** Surfaces the trail may mark; bridges are never in a cart's list. */
  surfaces: readonly RoadWearClass[];
}

const WALKER: TrailKind = {
  channel: GROUND_CHANNEL,
  contacts: [0],
  surfaces: [RoadWearClass.OffRoad]
};
const CART: TrailKind = {
  channel: RUT_CHANNEL,
  contacts: [-TRAFFIC_WEAR_TUNING.wheelHalfGauge, TRAFFIC_WEAR_TUNING.wheelHalfGauge],
  surfaces: [RoadWearClass.Dirt, RoadWearClass.Paved]
};

const isWalking = (actor: SettlementActor) =>
  actor.visible && (Boolean(actor.handcart) || actor.action === "walk" || actor.action === "carry");

/** Follows moving things between updates and hands each move to `draw`. */
const createTrailFollower = (draw: (trail: Trail, x: number, z: number) => void) => {
  const trails = new Map<number, Trail>();
  return {
    follow: (id: number, x: number, z: number, updates: number) => {
      const trail = trails.get(id);
      if (!trail) { trails.set(id, { seen: updates, x, z }); return; }
      draw(trail, x, z);
      trail.seen = updates; trail.x = x; trail.z = z;
    },
    forget: (id: number) => trails.delete(id),
    /** Things that left the frame list (died, boarded, shelved) drop their trail. */
    prune: (updates: number) => {
      for (const [id, trail] of trails) if (trail.seen < updates - 1) trails.delete(id);
    }
  };
};

/**
 * Draws trails into the field every `updateTicks` ticks: visible walkers wear only off-road ground
 * (footprints in the shader), moving hand carts mark both real wheel contacts on dirt and paved
 * roads. Bridges and verges wear nothing. Simulation state and hash are never touched.
 */
export const createTrafficWearSource = (
  simulation: TrafficWearSimulation, world: WorldData, roads: TrafficWearRoads = {},
  carts: () => readonly TrafficWearCart[] = () => []
): TrafficWearField & { dispose(): void; update(): void } => {
  const tuning = TRAFFIC_WEAR_TUNING, scale = tuning.texelsPerCell;
  const width = Math.ceil(world.cellsX * scale), height = Math.ceil(world.cellsZ * scale);
  const pixels = new Uint8Array(width * height * TRAFFIC_WEAR_CHANNELS);
  const touched = new Set<number>();
  const mask = createRoadWearMask(world.cellsX, world.cellsZ);
  /** Last texel of each contact on the current trail: every texel counts once per crossing. */
  const lastTexels = [-1, -1];
  let tick = 0, updates = 0, revision = 0, roadRevision = -1, changed = false;
  const syncRoads = () => {
    const current = roads.revision ?? 0;
    if (current === roadRevision) return;
    roadRevision = current;
    mask.rebuild(roads.segments?.() ?? []);
  };
  const texelAt = (x: number, z: number) => {
    const texelX = Math.floor(x * scale), texelZ = Math.floor(z * scale);
    if (texelX < 0 || texelZ < 0 || texelX >= width || texelZ >= height) return -1;
    return texelZ * width + texelX;
  };
  const storeLine = (texel: number, line: TrailPoint, established: boolean) => blendTrailLine(pixels, {
    byte: texel * TRAFFIC_WEAR_CHANNELS + TRAFFIC_WEAR_LINE_CHANNEL,
    centreX: (texel % width + 0.5) / scale, centreZ: (Math.floor(texel / width) + 0.5) / scale,
    heading: line.heading, x: line.x, z: line.z
  }, established);
  const deposit = (kind: TrailKind, contact: number, x: number, z: number, line: TrailPoint) => {
    const texel = texelAt(x, z);
    if (texel < 0 || texel === lastTexels[contact]) return;
    lastTexels[contact] = texel;
    if (!kind.surfaces.includes(mask.classAt(x, z))) return;
    const base = texel * TRAFFIC_WEAR_CHANNELS, value = pixels[base + kind.channel]!;
    // A cart's line wins in shared road-edge texels: walkers never overwrite a rut line.
    if (kind === CART || pixels[base + RUT_CHANNEL] === 0) storeLine(texel, line, value >= ESTABLISHED);
    pixels[base + kind.channel] = Math.min(WEAR_MAX, value + tuning.add);
    touched.add(texel);
    changed = true;
  };
  /** Contact points of `line`; with `mark` only remembers their texels (the trail's start). */
  const sample = (kind: TrailKind, line: TrailPoint, mark: boolean) => {
    const normalX = -Math.sin(line.heading), normalZ = Math.cos(line.heading);
    kind.contacts.forEach((offset, contact) => {
      const x = line.x + normalX * offset, z = line.z + normalZ * offset;
      if (mark) lastTexels[contact] = texelAt(x, z);
      else deposit(kind, contact, x, z, line);
    });
  };
  const drawTrail = (kind: TrailKind) => (trail: Trail, x: number, z: number) => {
    const distance = Math.hypot(x - trail.x, z - trail.z);
    if (distance < tuning.minMove || distance > tuning.maxTrail) return;
    const line = { heading: Math.atan2(z - trail.z, x - trail.x), x: trail.x, z: trail.z };
    // The start texels were worn by the previous move.
    sample(kind, line, true);
    const steps = Math.ceil(distance / tuning.trailStep);
    for (let step = 1; step <= steps; step++) {
      line.x = trail.x + (x - trail.x) * step / steps;
      line.z = trail.z + (z - trail.z) * step / steps;
      sample(kind, line, false);
    }
  };
  const walkers = createTrailFollower(drawTrail(WALKER));
  const wheels = createTrailFollower(drawTrail(CART));
  const fade = (byte: number) => { pixels[byte] = Math.max(0, pixels[byte]! - tuning.decay); };
  const decayTouched = () => {
    if (touched.size > 0) changed = true;
    for (const texel of touched) {
      const base = texel * TRAFFIC_WEAR_CHANNELS;
      fade(base + GROUND_CHANNEL);
      fade(base + RUT_CHANNEL);
      if (pixels[base + GROUND_CHANNEL] || pixels[base + RUT_CHANNEL]) continue;
      // A fully faded texel forgets its line, so the next trail sets a fresh one.
      pixels[base + TRAFFIC_WEAR_LINE_CHANNEL + 1] = 0;
      touched.delete(texel);
    }
    walkers.prune(updates);
    wheels.prune(updates);
  };
  const update = () => {
    updates++;
    changed = false;
    syncRoads();
    if (updates % tuning.decayEveryUpdates === 0) decayTouched();
    for (const actor of simulation.frames()) {
      if (isWalking(actor)) walkers.follow(actor.uid, actor.x, actor.z, updates);
      else walkers.forget(actor.uid);
    }
    for (const cart of carts()) wheels.follow(cart.id, cart.x, cart.z, updates);
    if (changed) revision++;
  };
  const unsubscribe = simulation.observeTicks(() => {
    tick++;
    if (tick % tuning.updateTicks === 0) update();
  });
  return { dispose: unsubscribe, height, pixels, update, width,
    get revision() { return revision; } };
};
