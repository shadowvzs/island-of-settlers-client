/**
 * Ships leaving the map through a sea exit, and coming back through it (2026-11-17, presentation only). The simulation
 * takes a ship off the map at its sea exit, which can lie several tiles inside the edge (seed 123: 6 tiles), so
 * the hull vanished in open water. The drawn hull now sails on from its last pose over the nearest map edge; a
 * ship that left this way and comes back sails in from the edge onto its live pose. Colony, raid, visitor and
 * channel-yield ships all leave and come back the same way.
 */

import type { ShipFrame } from "./ship-frame";

/** A drawn hull pose (tiles, heading in radians). */
export interface EdgePose { x: number; y: number; yaw: number; z: number }
/** The map's size in tiles. */
export interface MapBounds { cellsX: number; cellsZ: number }

/** The hull sails on this far beyond the edge before it is dropped (tiles). */
const BEYOND_EDGE = 6;
/** Sailing pace beyond the exit (tiles per second). */
const PASSAGE_SPEED = 2.4;
const PASSAGE_MIN_SECONDS = 1.5;
const PASSAGE_MAX_SECONDS = 8;
/** Share of the passage spent turning onto the course over the edge. */
const TURN_SHARE = .35;

/** A hull sailing over the edge: out from `from`, or (arriving) in from `edge` onto the live pose. */
export interface EdgePassage {
  edge: EdgePose;
  from: EdgePose;
  seconds: number;
  start: number;
}

const turnBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = (share: number) => share * share * (3 - 2 * share);

/** The point beyond the map edge nearest `pose`, heading out over it. */
export const edgeBeyond = (pose: EdgePose, bounds: MapBounds): EdgePose => {
  const sides = [
    { distance: pose.x, x: -BEYOND_EDGE, yaw: -Math.PI / 2, z: pose.z },
    { distance: bounds.cellsX - pose.x, x: bounds.cellsX + BEYOND_EDGE, yaw: Math.PI / 2, z: pose.z },
    { distance: pose.z, x: pose.x, yaw: Math.PI, z: -BEYOND_EDGE },
    { distance: bounds.cellsZ - pose.z, x: pose.x, yaw: 0, z: bounds.cellsZ + BEYOND_EDGE }
  ];
  const nearest = sides.reduce((best, side) => side.distance < best.distance ? side : best);
  return { x: nearest.x, y: pose.y, yaw: nearest.yaw, z: nearest.z };
};

/** A passage between `from` and the edge beyond it, starting at `time` (seconds). */
export const planEdgePassage = (from: EdgePose, bounds: MapBounds, time: number): EdgePassage => {
  const edge = edgeBeyond(from, bounds), distance = Math.hypot(edge.x - from.x, edge.z - from.z);
  const seconds = Math.min(PASSAGE_MAX_SECONDS, Math.max(PASSAGE_MIN_SECONDS, distance / PASSAGE_SPEED));
  return { edge, from: { ...from }, seconds, start: time };
};

/** How far along the passage is at `time` (0 to 1). */
export const passageShare = (passage: EdgePassage, time: number) =>
  Math.min(1, Math.max(0, (time - passage.start) / passage.seconds));

/** The leaving hull at `time`: it turns onto the course over the edge and sails on, gathering way. */
export const leavingPose = (passage: EdgePassage, time: number): EdgePose => {
  const share = passageShare(passage, time), { edge, from } = passage;
  const course = Math.atan2(edge.x - from.x, edge.z - from.z);
  const turn = smooth(Math.min(1, share / TURN_SHARE)), along = share * share;
  return { x: from.x + (edge.x - from.x) * along, y: from.y, yaw: from.yaw + turnBetween(from.yaw, course) * turn,
    z: from.z + (edge.z - from.z) * along };
};

/** The arriving hull at `time`: in from beyond the edge, easing onto the live pose `to`. */
export const arrivingPose = (passage: EdgePassage, to: EdgePose, time: number): EdgePose => {
  const share = smooth(passageShare(passage, time)), { edge } = passage;
  const course = Math.atan2(to.x - edge.x, to.z - edge.z);
  const yaw = share < 1 - TURN_SHARE ? course : course + turnBetween(course, to.yaw) *
    smooth((share - 1 + TURN_SHARE) / TURN_SHARE);
  return { x: edge.x + (to.x - edge.x) * share, y: to.y, yaw, z: edge.z + (to.z - edge.z) * share };
};

/**
 * Ships passing over the map edge, applied to the drawn ship frames before anything is posed on them (deck
 * passengers, horses, wakes, the hull): `apply` gives this frame's ships with a returning ship's pose eased in from
 * beyond the edge, plus the ships just gone off the map still sailing on over it (empty decks, since their people
 * are out of sight with them). Hulls that sank, were dismantled or never sailed off are dropped as before; without
 * `bounds` the frames pass through unchanged.
 */
export const createEdgePassages = (bounds?: MapBounds) => {
  let previous = new Map<number, ShipFrame>();
  const leaving = new Map<number, EdgePassage & { frame: ShipFrame }>();
  const arriving = new Map<number, EdgePassage>();
  const departed = new Set<number>();
  const arrive = (frame: ShipFrame, time: number): ShipFrame => {
    leaving.delete(frame.id);
    if (!previous.has(frame.id) && departed.delete(frame.id))
      arriving.set(frame.id, planEdgePassage(frame, bounds!, time));
    const passage = arriving.get(frame.id);
    if (!passage) return frame;
    if (passageShare(passage, time) < 1) return { ...frame, ...arrivingPose(passage, frame, time) };
    arriving.delete(frame.id);
    return frame;
  };
  const startLeaving = (frame: ShipFrame, time: number) => {
    if (frame.phase !== "sailing" || (frame.sinkProgress ?? 0) > 0) return;
    const out = { ...frame, deckHorse: undefined, deckPassengers: 0, deckTroops: [], passengers: [] };
    leaving.set(frame.id, { ...planEdgePassage(frame, bounds!, time), frame: out });
    departed.add(frame.id);
  };
  const apply = (ships: readonly ShipFrame[], time: number): readonly ShipFrame[] => {
    if (!bounds) return ships;
    const drawn = ships.map(frame => arrive(frame, time)), present = new Set(ships.map(frame => frame.id));
    for (const [id, frame] of previous) if (!present.has(id) && !leaving.has(id)) startLeaving(frame, time);
    for (const [id, passage] of leaving) {
      if (passageShare(passage, time) >= 1) { leaving.delete(id); continue; }
      drawn.push({ ...passage.frame, ...leavingPose(passage, time) });
    }
    previous = new Map(ships.map(frame => [frame.id, frame]));
    return drawn;
  };
  return { apply };
};
