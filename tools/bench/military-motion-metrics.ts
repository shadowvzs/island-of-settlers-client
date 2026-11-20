import { performance } from "node:perf_hooks";

import type { MilitaryCombatant } from "../../src/shared/settlement/military-combat-rules";
import { actorSeparation } from "../../src/shared/settlement/settlement-traffic";
import type { SettlementActor } from "../../src/shared/settlement/settlement-types";
import type { MotionScenario } from "./military-motion-scenarios";

/**
 * Motion and close-combat metrics of a military scenario (docs/archive/dated/military-motion-2026-10-13.md).
 * Sampled after every 0.05 s tick; the tick time excludes the measuring itself.
 */
export interface MotionMetrics {
  /** Pairs of soldiers coming into contact (closer than their separation + 0.05) per game second. */
  contactsPerSecond: number;
  /** Pair-seconds of deep overlap (closer than 85 % of the separation) per game second. */
  overlapPerSecond: number;
  /** Walking soldiers stopped by a soldier just ahead (the bump), per game second. */
  bumpStopsPerSecond: number;
  /** Soldier-seconds wanting to move but not moving; and the part of it beyond one second at a time. */
  stallSeconds: number;
  stuckSeconds: number;
  /** The longest single stall of one soldier (seconds). */
  longestStallSeconds: number;
  /** Direction reversals (> 135° within half a second while walking) away from a fight, and within one. */
  aboutFaces: number;
  duelReversals: number;
  /** Mean turning of walking soldiers (radians per walking second). */
  turnRate: number;
  /** Walked distance over straight distance (soldiers that moved more than 5 tiles): mean and p90. */
  pathRatio: number;
  pathRatioP90: number;
  /** Seconds until 95 % of a group order stands at its places (null: not reached). */
  arrivalSeconds: number | null;
  /** Seconds from the order to the first blow, and the median soldier's first blow. */
  firstBlowSeconds: number | null;
  medianEngageSeconds: number | null;
  /** Melee attackers fighting one target (within 1.3 tiles, 2.6 with a horse): mean over targets and maximum. */
  attackersMean: number;
  attackersMax: number;
  /** Share of engaged target-ticks with more than two melee attackers on it. */
  crowdedTargets: number;
  /** Fighting soldiers' spread across the battle axis over the spread along it (higher: a front line). */
  frontRatio: number;
  /** Mean distance from a fighting melee soldier to its nearest fighting comrade (tiles). */
  duelSpacing: number;
  /** Share of blows started in the same tick as another blow of the same side within 3 tiles. */
  syncedBlows: number;
  /** Simulation tick (ms): p50, p95, max. */
  tickP50: number;
  tickP95: number;
  tickMax: number;
  survivors: string;
  /** Seconds until only one side has soldiers left (null: not decided within the run). */
  decidedSeconds: number | null;
  /** Soldiers lost per side ("faction:count"). */
  losses: string;
}

const FIELD_PHASES = new Set(["militaryField", "militarySiege"]);
const CONTACT_PAD = .05;
const OVERLAP_SHARE = .85;
const REVERSAL_WINDOW = 5;
const REVERSAL_SPEED = .3;
const STALL_SHARE = .15;
/** A melee soldier this close to its target (tiles; more when a horse is involved) is fighting it. */
const ENGAGED_RANGE = 1.3;
const MOUNTED_ENGAGED_RANGE = 2.6;
const FRONT_WINDOW = 20;

interface Track {
  startX: number; startZ: number; walked: number; stall: number; lastYaw: number;
  history: { x: number; z: number }[];
  previousDirection?: { x: number; z: number };
  wasWalking: boolean; lastAttack: number; firstBlow?: number;
}
interface Body { actor: SettlementActor; state: MilitaryCombatant; track: Track }

const percentile = (values: readonly number[], share: number) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
};
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Positions per soldier for the frame sheets. */
export interface MotionFrame {
  time: number;
  soldiers: { attacking: boolean; faction: number; mounted: boolean; type: string; uid: number; x: number;
    yaw: number; z: number }[];
}

export const createMotionRecorder = (scenario: MotionScenario) => {
  const { simulation } = scenario;
  const tracks = new Map<number, Track>(), contacts = new Set<number>(), ticks: number[] = [];
  const counters = { aboutFaces: 0, blows: 0, bumpStops: 0, contacts: 0, duelReversals: 0, overlap: 0,
    longestStall: 0, stall: 0, stuck: 0, synced: 0, turning: 0, walkingSeconds: 0 };
  const attackers: number[] = [], spacing: number[] = [], fronts: number[] = [];
  let time = 0, crowded = 0, arrival: number | null = null, firstBlow: number | null = null;
  let decided: number | null = null, initial: Map<number, number> | undefined, remaining = new Map<number, number>();
  /** Soldiers per side, garrisons included (decides the battle). */
  const sideCounts = () => {
    const counts = new Map<number, number>();
    for (const soldier of simulation.militarySoldiers()) {
      const faction = soldier.combat?.faction ?? 0;
      counts.set(faction, (counts.get(faction) ?? 0) + 1);
    }
    return counts;
  };
  const sampleOutcome = () => {
    remaining = sideCounts();
    initial ??= new Map(remaining);
    if (decided === null && initial.size > 1 && remaining.size === 1) decided = time;
  };
  const bodies = () => {
    const states = new Map(simulation.militarySoldiers().map(soldier => [soldier.actor, soldier.combat]));
    const list: Body[] = [];
    for (const actor of simulation.frames()) {
      const state = states.get(actor.uid);
      if (!state || !actor.visible || !FIELD_PHASES.has(actor.phase)) continue;
      let track = tracks.get(actor.uid);
      if (!track) {
        track = { history: [], lastAttack: 0, lastYaw: actor.yaw, stall: 0, startX: actor.x, startZ: actor.z,
          walked: 0, wasWalking: false };
        tracks.set(actor.uid, track);
      }
      list.push({ actor, state, track });
    }
    return list;
  };
  const engagedWith = (body: Body, byId: Map<number, Body>) => {
    const target = body.state.target === undefined ? undefined : byId.get(body.state.target);
    if (!target) return undefined;
    const distance = Math.hypot(target.actor.x - body.actor.x, target.actor.z - body.actor.z);
    const range = body.actor.mounted || target.actor.mounted ? MOUNTED_ENGAGED_RANGE : ENGAGED_RANGE;
    return distance <= range ? target : undefined;
  };
  const samplePairs = (list: readonly Body[], dt: number) => {
    const touching = new Set<number>();
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const one = list[a]!.actor, two = list[b]!.actor;
      const distance = Math.hypot(one.x - two.x, one.z - two.z);
      if (distance > 2.5) continue;
      const separation = actorSeparation(one, two);
      if (distance < separation * OVERLAP_SHARE) counters.overlap += dt;
      if (distance >= separation + CONTACT_PAD) continue;
      const key = Math.min(one.uid, two.uid) * 65536 + Math.max(one.uid, two.uid);
      touching.add(key);
      if (!contacts.has(key)) counters.contacts++;
    }
    contacts.clear();
    for (const key of touching) contacts.add(key);
  };
  const isWalking = (body: Body) => body.actor.pathIndex < body.actor.path.length && !(body.state.attackTime ?? 0);
  const sampleMotion = (body: Body, list: readonly Body[], fighting: boolean, dt: number) => {
    const { actor, track } = body;
    const last = track.history.at(-1) ?? { x: track.startX, z: track.startZ };
    const moved = Math.hypot(actor.x - last.x, actor.z - last.z);
    track.walked += moved;
    track.history.push({ x: actor.x, z: actor.z });
    if (track.history.length > REVERSAL_WINDOW * 2 + 1) track.history.shift();
    const walking = isWalking(body), expected = (actor.mounted ? 3.6 : .8) * dt;
    const stalled = walking && moved < expected * STALL_SHARE;
    if (stalled) {
      counters.stall += dt; track.stall += dt;
      if (track.stall > 1) counters.stuck += dt;
      counters.longestStall = Math.max(counters.longestStall, track.stall);
      const blocker = list.some(other => other !== body &&
        Math.hypot(other.actor.x - actor.x, other.actor.z - actor.z) < actorSeparation(actor, other.actor) + .2);
      if (track.wasWalking && blocker) counters.bumpStops++;
    } else track.stall = 0;
    track.wasWalking = walking && !stalled;
    if (moved > expected * .3) {
      counters.turning += Math.abs(wrapAngle(actor.yaw - track.lastYaw)); counters.walkingSeconds += dt;
    }
    track.lastYaw = actor.yaw;
    sampleReversal(track, fighting);
  };
  const sampleReversal = (track: Track, fighting: boolean) => {
    if (track.history.length < REVERSAL_WINDOW * 2 + 1) return;
    const [first, middle, latest] = [track.history[0]!, track.history[REVERSAL_WINDOW]!, track.history.at(-1)!];
    const before = { x: middle.x - first.x, z: middle.z - first.z }, after = { x: latest.x - middle.x, z: latest.z - middle.z };
    const window = REVERSAL_WINDOW * .05, minimum = REVERSAL_SPEED * window;
    const lengths = [Math.hypot(before.x, before.z), Math.hypot(after.x, after.z)];
    if (lengths[0]! < minimum || lengths[1]! < minimum) return;
    const cosine = (before.x * after.x + before.z * after.z) / (lengths[0]! * lengths[1]!);
    if (cosine > Math.cos(Math.PI * .75)) return;
    if (fighting) counters.duelReversals++; else counters.aboutFaces++;
    track.history.splice(0, REVERSAL_WINDOW);
  };
  const sampleBlows = (list: readonly Body[]) => {
    const started: Body[] = [];
    for (const body of list) {
      const attack = body.state.attackTime ?? 0;
      if (attack > body.track.lastAttack + .3 && body.actor.phase === "militaryField") {
        started.push(body); counters.blows++;
        body.track.firstBlow ??= time; firstBlow ??= time;
      }
      body.track.lastAttack = attack;
    }
    for (const body of started) if (started.some(other => other !== body &&
      other.state.faction === body.state.faction &&
      Math.hypot(other.actor.x - body.actor.x, other.actor.z - body.actor.z) < 3)) counters.synced++;
  };
  const sampleFight = (list: readonly Body[], byId: Map<number, Body>) => {
    const perTarget = new Map<number, number>(), fighters: Body[] = [];
    for (const body of list) {
      if (body.state.type === "archer" || body.actor.phase !== "militaryField") continue;
      const target = engagedWith(body, byId);
      if (!target) continue;
      fighters.push(body);
      perTarget.set(target.actor.uid, (perTarget.get(target.actor.uid) ?? 0) + 1);
    }
    for (const count of perTarget.values()) { attackers.push(count); if (count > 2) crowded++; }
    for (const body of fighters) {
      let nearest = Infinity;
      for (const other of fighters) if (other !== body && other.state.faction === body.state.faction)
        nearest = Math.min(nearest, Math.hypot(other.actor.x - body.actor.x, other.actor.z - body.actor.z));
      if (nearest < Infinity) spacing.push(nearest);
    }
    if (firstBlow !== null && time - firstBlow <= FRONT_WINDOW && fighters.length >= 6) fronts.push(frontRatio(fighters, list));
  };
  const sampleArrival = (list: readonly Body[]) => {
    if (!scenario.marching || arrival !== null || !list.length) return;
    const standing = list.filter(body => !body.state.destination && body.actor.pathIndex >= body.actor.path.length);
    if (standing.length >= list.length * .95) arrival = time;
  };
  /** Each tick: run the simulation (timed) and measure. */
  const step = (dt = .05) => {
    const started = performance.now();
    simulation.update(dt);
    ticks.push(performance.now() - started);
    time += dt;
    const list = bodies(), byId = new Map(list.map(body => [body.actor.uid, body]));
    samplePairs(list, dt);
    for (const body of list) sampleMotion(body, list, engagedWith(body, byId) !== undefined, dt);
    sampleBlows(list);
    sampleFight(list, byId);
    sampleArrival(list);
    sampleOutcome();
  };
  const summary = (): MotionMetrics => {
    const ratios = [...tracks.values()].flatMap(track => {
      const last = track.history.at(-1);
      const straight = last ? Math.hypot(last.x - track.startX, last.z - track.startZ) : 0;
      return straight > 5 ? [track.walked / straight] : [];
    });
    const firsts = [...tracks.values()].flatMap(track => track.firstBlow === undefined ? [] : [track.firstBlow]);
    const factions = new Map<number, number>();
    for (const body of bodies()) factions.set(body.state.faction, (factions.get(body.state.faction) ?? 0) + 1);
    const losses = [...(initial ?? new Map<number, number>()).entries()].sort(([a], [b]) => a - b)
      .map(([faction, count]) => `${faction}:${count - (remaining.get(faction) ?? 0)}`).join(" ");
    return {
      aboutFaces: counters.aboutFaces, arrivalSeconds: arrival === null ? null : round(arrival, 1),
      attackersMax: Math.max(0, ...attackers), attackersMean: round(mean(attackers)),
      bumpStopsPerSecond: round(counters.bumpStops / time), contactsPerSecond: round(counters.contacts / time),
      crowdedTargets: round(crowded / (attackers.length || 1)),
      decidedSeconds: decided === null ? null : round(decided, 1), duelReversals: counters.duelReversals,
      duelSpacing: round(mean(spacing)), firstBlowSeconds: firstBlow === null ? null : round(firstBlow, 1),
      frontRatio: round(mean(fronts)), longestStallSeconds: round(counters.longestStall, 1), losses,
      medianEngageSeconds: firsts.length ? round(percentile(firsts, .5), 1) : null,
      overlapPerSecond: round(counters.overlap / time, 3), pathRatio: round(mean(ratios)),
      pathRatioP90: round(percentile(ratios, .9)), stallSeconds: round(counters.stall, 1),
      stuckSeconds: round(counters.stuck, 1),
      survivors: [...factions.entries()].sort(([a], [b]) => a - b).map(([faction, count]) => `${faction}:${count}`).join(" "),
      syncedBlows: round(counters.synced / (counters.blows || 1)),
      tickMax: round(Math.max(0, ...ticks)), tickP50: round(percentile(ticks, .5)), tickP95: round(percentile(ticks, .95)),
      turnRate: round(counters.turning / (counters.walkingSeconds || 1))
    };
  };
  const frame = (): MotionFrame => ({ time: round(time, 1), soldiers: bodies().map(({ actor, state }) => ({
    attacking: (state.attackTime ?? 0) > 0, faction: state.faction, mounted: Boolean(actor.mounted), type: state.type,
    uid: actor.uid, x: actor.x, yaw: actor.yaw, z: actor.z })) });
  /** The current stall (seconds) of one soldier (0: walking freely or not tracked). */
  const stallOf = (uid: number) => tracks.get(uid)?.stall ?? 0;
  return { frame, stallOf, step, summary, time: () => time };
};

/** Spread of the fighters across the line between the two sides' centres over the spread along it. */
const frontRatio = (fighters: readonly Body[], everyone: readonly Body[]) => {
  const centre = (faction: number) => {
    const members = everyone.filter(body => body.state.faction === faction);
    return { x: mean(members.map(body => body.actor.x)), z: mean(members.map(body => body.actor.z)) };
  };
  const factions = [...new Set(everyone.map(body => body.state.faction))].sort((a, b) => a - b);
  if (factions.length < 2) return 0;
  const one = centre(factions[0]!), two = centre(factions[1]!);
  const length = Math.hypot(two.x - one.x, two.z - one.z) || 1;
  const axis = { x: (two.x - one.x) / length, z: (two.z - one.z) / length };
  const along = fighters.map(body => body.actor.x * axis.x + body.actor.z * axis.z);
  const across = fighters.map(body => body.actor.x * -axis.z + body.actor.z * axis.x);
  const deviation = (values: readonly number[]) => {
    const average = mean(values);
    return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
  };
  return deviation(across) / Math.max(.3, deviation(along));
};

/** Runs a scenario to its end; `frames` game-second marks get a frame for the sheets. */
export const runMotionScenario = (scenario: MotionScenario, frameTimes: readonly number[] = []) => {
  const recorder = createMotionRecorder(scenario), frames: MotionFrame[] = [];
  scenario.start();
  const pending = [...frameTimes];
  for (let tick = 0; tick < scenario.seconds * 20; tick++) {
    recorder.step();
    if (pending.length && recorder.time() >= pending[0]! - 1e-6) { pending.shift(); frames.push(recorder.frame()); }
  }
  return { frames, metrics: recorder.summary() };
};
