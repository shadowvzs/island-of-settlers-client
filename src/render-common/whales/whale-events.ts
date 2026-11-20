import { WHALE_SPECIES, type WhaleSpecies } from "./whale-species";

/**
 * The surfacing events, authored as key poses (humpback seconds; the orca runs them faster).
 * Channels: travel along the heading and depth of the body's middle below the water (both in
 * body lengths), pitch, roll, arch, pectoral turn (radians / body lengths), fluke stroke amplitude.
 * Splashes are not authored: the director finds them where body points cross the surface.
 */
export const WHALE_EVENTS = ["roll", "breach", "tailSlap", "blow"] as const;
export type WhaleEventKind = (typeof WHALE_EVENTS)[number];

/** [time, travel, depth, pitch, roll, arch, pectoral, stroke] */
type Key = readonly [number, number, number, number, number, number, number, number];

export interface WhaleChannels {
  arch: number;
  depth: number;
  pectoral: number;
  pitch: number;
  roll: number;
  stroke: number;
  travel: number;
}

export interface WhaleEventTrack {
  /** Seconds of the blows (spouts) from the blowhole. */
  blows: readonly number[];
  duration: number;
  keys: readonly Key[];
}

/** Back rises, a blow, a roll on the side waving a flipper (two slaps), then a fluke-up dive. */
const ROLL: WhaleEventTrack = {
  blows: [3.6],
  duration: 19.5,
  keys: [
    [0, 0, -0.45, 0.18, 0, 0, 0, 0.05],
    [2.5, 0.4, -0.12, 0.08, 0, 0, 0, 0.035],
    [3.5, 0.55, -0.035, 0, 0, 0, 0, 0.02],
    [6, 0.9, -0.04, 0.03, 0.3, -0.3, 0.2, 0.02],
    [7.6, 1.15, -0.03, 0.06, 1.1, -0.65, 1.1, 0.012],
    [8.3, 1.25, -0.03, 0.06, 1.15, -0.65, -0.35, 0.012],
    [9.3, 1.4, -0.03, 0.06, 1.1, -0.65, 1.1, 0.012],
    [10, 1.5, -0.03, 0.06, 1.15, -0.65, -0.35, 0.012],
    [11.5, 1.7, -0.04, 0, 0.2, 0, 0.1, 0.02],
    [13.2, 1.9, -0.045, -0.15, 0, -0.6, 0, 0.02],
    [14.8, 2.02, -0.14, -0.55, 0, -0.45, 0, 0.02],
    [16.4, 2.08, -0.24, -1.15, 0, 0, 0, 0.025],
    [17.6, 2.1, -0.4, -1.35, 0, 0.1, 0, 0.03],
    [19.5, 2.14, -0.9, -1.3, 0, 0, 0, 0.04]
  ]
};

/** Up from the depth, three quarters out of the water, twisting onto its back, a crashing fall. */
const BREACH: WhaleEventTrack = {
  blows: [],
  duration: 10,
  keys: [
    [0, 0, -0.95, 0.6, 0, 0, 0, 0.06],
    [1.4, 0.15, -0.62, 0.95, 0, 0, 0.1, 0.07],
    [2.2, 0.25, -0.24, 1.15, 0.2, 0, 0.6, 0.05],
    [3, 0.32, 0.1, 1.22, 0.8, 0.1, 1.1, 0.02],
    [3.8, 0.4, 0.04, 0.72, 1.6, 0.12, 1.2, 0.01],
    [4.5, 0.5, -0.12, 0.12, 2.1, 0, 0.9, 0.01],
    [5.5, 0.62, -0.32, -0.12, 2.4, 0, 0.4, 0.02],
    [7.5, 0.8, -0.6, -0.2, 2.9, 0, 0, 0.03],
    [10, 0.95, -0.95, -0.25, 3.1, 0, 0, 0.04]
  ]
};

/** Head down, the tail stock raised, three flukes slapped flat on the water. */
const TAIL_SLAP: WhaleEventTrack = {
  blows: [],
  duration: 13,
  keys: [
    [0, 0, -0.5, 0.1, 0, 0, 0, 0.04],
    [2.5, 0.2, -0.22, -0.3, 0, 0, 0, 0.03],
    [4, 0.3, -0.28, -0.75, 0, 0.5, 0, 0.02],
    [5.2, 0.32, -0.28, -0.78, 0, 0.62, 0, 0.01],
    [5.55, 0.33, -0.3, -0.75, 0, -0.4, 0, 0.01],
    [6.8, 0.34, -0.28, -0.78, 0, 0.62, 0, 0.01],
    [7.15, 0.35, -0.3, -0.75, 0, -0.4, 0, 0.01],
    [8.4, 0.36, -0.28, -0.78, 0, 0.62, 0, 0.01],
    [8.75, 0.37, -0.3, -0.75, 0, -0.4, 0, 0.01],
    [10.5, 0.4, -0.42, -0.9, 0, 0.1, 0, 0.02],
    [13, 0.45, -0.8, -0.6, 0, 0, 0, 0.03]
  ]
};

/** A blow sequence: two surfacings with a spout each, the back rolling over between them. */
const BLOW: WhaleEventTrack = {
  blows: [2.7, 7.7],
  duration: 16,
  keys: [
    [0, 0, -0.4, 0.15, 0, 0, 0, 0.04],
    [2.5, 0.35, -0.04, 0.02, 0, 0, 0, 0.025],
    [4.5, 0.65, -0.04, -0.02, 0, -0.1, 0, 0.02],
    [6, 0.85, -0.12, -0.08, 0, -0.15, 0, 0.025],
    [7.5, 1.05, -0.04, 0.04, 0, 0, 0, 0.025],
    [9.5, 1.32, -0.04, -0.02, 0, -0.05, 0, 0.02],
    [11, 1.5, -0.1, -0.2, 0, -0.45, 0, 0.025],
    [12.5, 1.65, -0.25, -0.45, 0, -0.5, 0, 0.03],
    [14.5, 1.8, -0.55, -0.5, 0, -0.1, 0, 0.04],
    [16, 1.9, -0.8, -0.4, 0, 0, 0, 0.04]
  ]
};

const TRACKS: Readonly<Record<WhaleEventKind, WhaleEventTrack>> = {
  blow: BLOW, breach: BREACH, roll: ROLL, tailSlap: TAIL_SLAP
};

/** Seconds of the orca per humpback second (a smaller, quicker animal). */
const ORCA_TIME = 0.72;

export const getEventTimeScale = (species: WhaleSpecies) => (species === WHALE_SPECIES.orca ? ORCA_TIME : 1);

export const getEventTrack = (kind: WhaleEventKind) => TRACKS[kind];

/**
 * Share of the authored travel a whale swims (owner 2026-11-10: the whole event stays on screen, so
 * the paths are short and the whale lingers where it surfaced; the depth rule is unchanged).
 */
export const EVENT_TRAVEL_SCALE: Readonly<Record<WhaleEventKind, number>> = {
  blow: 0.45, breach: 0.6, roll: 0.4, tailSlap: 1
};

/** Body lengths an event travels along its heading (`scaled` false: as authored). */
export const getEventTravel = (kind: WhaleEventKind, scaled = true) => {
  const keys = TRACKS[kind].keys;
  return keys[keys.length - 1]![1] * (scaled ? EVENT_TRAVEL_SCALE[kind] : 1);
};

/** Seconds an event lasts for a species. */
export const getEventDuration = (kind: WhaleEventKind, species: WhaleSpecies) =>
  TRACKS[kind].duration * getEventTimeScale(species);

/**
 * Hermite tangent (per second) that is flat at a turning key and limited to three times either
 * neighbouring slope (Fritsch-Carlson): no overshoot past held or extreme poses.
 */
const tangentAt = (keys: readonly Key[], index: number, channel: number) => {
  if (index <= 0 || index >= keys.length - 1) return 0;
  const [previous, key, next] = [keys[index - 1]!, keys[index]!, keys[index + 1]!];
  const before = (key[channel]! - previous[channel]!) / (key[0] - previous[0]);
  const after = (next[channel]! - key[channel]!) / (next[0] - key[0]);
  if (before * after <= 0) return 0;
  const centred = (next[channel]! - previous[channel]!) / (next[0] - previous[0]);
  return Math.sign(centred) * Math.min(Math.abs(centred), 3 * Math.abs(before), 3 * Math.abs(after));
};

const CHANNEL_NAMES = ["travel", "depth", "pitch", "roll", "arch", "pectoral", "stroke"] as const;

/** Channels of a track at `seconds` (in the track's own humpback time). */
export const sampleEventTrack = (track: WhaleEventTrack, seconds: number, out: WhaleChannels) => {
  const keys = track.keys;
  let index = 0;
  while (index < keys.length - 2 && seconds > keys[index + 1]![0]) index += 1;
  const from = keys[index]!;
  const to = keys[index + 1]!;
  const span = to[0] - from[0];
  const t = Math.min(1, Math.max(0, (seconds - from[0]) / span));
  const t2 = t * t;
  const t3 = t2 * t;
  const [h00, h10, h01, h11] = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
  for (let offset = 0; offset < CHANNEL_NAMES.length; offset += 1) {
    const channel = offset + 1;
    out[CHANNEL_NAMES[offset]!] = h00 * from[channel]! + h01 * to[channel]!
      + span * (h10 * tangentAt(keys, index, channel) + h11 * tangentAt(keys, index + 1, channel));
  }
  return out;
};
