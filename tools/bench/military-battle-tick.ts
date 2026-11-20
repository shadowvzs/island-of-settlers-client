import { performance } from "node:perf_hooks";

import { COMMANDER_MARCH_PHASE, COMMANDER_PHASE } from "../../src/shared/settlement/commander/commander-phases";
import { resolveCommanderProfile } from "../../src/shared/settlement/commander/commander-profile-source";
import { isDifficultyLevel } from "../../src/shared/settlement/difficulty";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../../src/shared/settlement/settlement-state-hash";
import { setTickPhaseRecorder, type TickPhaseRecorder } from "../../src/shared/settlement/tick-phase-profile";
import type { WorldData } from "../../src/shared/world/world-data";
import { emitBenchJson } from "./bench-json";
import { createBalanceSimulation, forceTroops, spawnAround, typicalForce } from "./garrison-balance-harness";

/**
 * Military battle tick bench (docs/archive/dated/battle-ai-plan-2026-10-12.md, Phase 0): 64 player soldiers
 * against 64 computer soldiers, mixed foot troops (ordinary cavalry is retired, HORSE-RETIREMENT-01), on a flat
 * island and on a narrow coastal strip (sea on both flanks, narrower than the foot battle line).
 * Reports the simulation tick (0.05 s) average, p95 and maximum over the whole battle and over the
 * first seconds of contact, and the stall check: no armed enemy pair within 24 tiles both idle.
 * Closest pair: the closest approach of the two armies during the battle and their distance at its end
 * (`-` when one side is wiped out). Nearest shore: how close a soldier came to the sea (coastal strip only);
 * a value near 0 proves the coast constrains the fight.
 * The simulation is the same on every detail level (Minimal and High only change the renderer).
 * Run: `npx tsx tools/bench/military-battle-tick.ts` (`SIZE=32` per side, `SECONDS=180`).
 * `PHASES=1` (A14-0) also times the computer commander's `commander` tick phase and prints the final save
 * hash of each battle; the hash is the same with and without it (the recorder only observes).
 * `BENCH_JSON=1` (set by the A/B runner `ab-runner.ts`) adds one `BENCH_JSON` line per battle.
 * `DIFFICULTY=hard|veryHard` (A14-5) runs the global difficulty: the computer commander plays the hard profile
 * (a decision per second) or the Very hard one (0.75 s); the decision spans follow that interval.
 * `TARGET=1` (targetMilitary, 2026-11-17): from first contact, every 5 s each player soldier without a chase lock
 * joins a squad of eight that targets the enemy nearest its first member (right click on an enemy body).
 * `FLAT_ONLY=1` skips the coastal strip (it has no room for SIZE=150).
 * `QUEUE=1` (Shift queue, 2026-11-17): from first contact, every 5 s each player soldier outside a queue joins a
 * squad of eight that Shift-queues three steps: an attack-move to the enemy nearest its first member, a chase of
 * that enemy and an attack-move on to the enemy camp.
 */
const SIDE = Number(process.env.SIZE ?? 64);
const SECONDS = Number(process.env.SECONDS ?? 180);
const MAP = 96;
const TICK = .05;
const CONTACT_RANGE = 8;
const CONTACT_SECONDS = 10;
const STALL_RANGE = 24;
/** Ticks between the samples of the closest pair and of the nearest shore (outside the timed tick). */
const SAMPLE_TICKS = 10;
const PLAYER_RALLY = { x: 30, z: 48 };
const ENEMY_CAMP = { x: 62, z: 48 };
/** Foot only: ordinary cavalry is retired (HORSE-RETIREMENT-01). */
const TYPES: readonly MilitaryTroopType[] = ["shield", "heavy", "archer"];
/**
 * One computer faction decides once per interval of its profile (medium 1.5 s, 30 ticks): the slowest 1/30 of
 * the spans are its decisions.
 */
const DECISION_TICKS = Math.round(resolveCommanderProfile({
  global: isDifficultyLevel(process.env.DIFFICULTY) ? process.env.DIFFICULTY : undefined
}).decisionInterval / TICK);
const PROFILE_PHASES = process.env.PHASES === "1";
const TARGET_UNITS = process.env.TARGET === "1";
const TARGET_SQUAD = 8;
const TARGET_EVERY_TICKS = 100;
const QUEUE_ORDERS = process.env.QUEUE === "1";
/** QUEUE=1: accepted queueMilitaryOrder calls (printed once at the end). */
let queuedSteps = 0;
/** The morale tick phase (`settlement-combat-morale.ts`), named here so the bench also runs on older commits. */
const MORALE_PHASE = "morale";
/** The faction knowledge's end-of-tick phase (`settlement-vision.ts`; A14-4b strategic knowledge runs in it). */
const KNOWLEDGE_PHASE = "knowledge";

/**
 * Half the depth of the coastal strip. A 64 vs 64 foot battle line spreads over about 11 tiles (z 43.4 to 54.2
 * on the flat island), so the 8 tile strip squeezes both formations between its two shores. The former 24 tile
 * strip only constrained the retired cavalry's flanking and left the foot battle identical to the flat one.
 */
const COAST_HALF_DEPTH = 4;

/** A strip of land `2 * COAST_HALF_DEPTH` tiles deep across the map: the rest is sea (unwalkable). */
const carveCoast = (world: WorldData) => {
  for (let z = 0; z < MAP; z++) for (let x = 0; x < MAP; x++)
    if (Math.abs(z + .5 - PLAYER_RALLY.z) > COAST_HALF_DEPTH) world.walkCost[z * MAP + x] = 0;
};

const fieldSoldiers = (simulation: SettlementSimulation, hostile: boolean) => {
  const bodies = new Map(simulation.frames().map(actor => [actor.uid, actor]));
  return simulation.militarySoldiers().filter(soldier => ((soldier.combat?.faction ?? 0) > 0) === hostile &&
    bodies.get(soldier.actor)?.phase === "militaryField").map(soldier => ({ body: bodies.get(soldier.actor)!, soldier }));
};

/** The enemy nearest to `lead`. */
const nearestEnemy = (enemies: ReturnType<typeof fieldSoldiers>, lead: { x: number; z: number }) =>
  enemies.reduce((best, entry) => Math.hypot(entry.body.x - lead.x, entry.body.z - lead.z) <
    Math.hypot(best.body.x - lead.x, best.body.z - lead.z) ? entry : best);

/** TARGET=1: free player soldiers lock, eight at a time, onto the enemy nearest the squad's first member. */
const targetNearestEnemies = (simulation: SettlementSimulation) => {
  const enemies = fieldSoldiers(simulation, true);
  const free = fieldSoldiers(simulation, false).filter(entry => !entry.soldier.combat?.chase);
  for (let first = 0; first < free.length && enemies.length; first += TARGET_SQUAD) {
    const squad = free.slice(first, first + TARGET_SQUAD), nearest = nearestEnemy(enemies, squad[0]!.body);
    simulation.targetMilitary(squad.map(entry => entry.soldier.actor), nearest.soldier.actor);
  }
};

/** QUEUE=1: free player soldiers, eight at a time, queue a ground step, a chase and a step on to the camp. */
const queueSquadOrders = (simulation: SettlementSimulation) => {
  const enemies = fieldSoldiers(simulation, true);
  const free = fieldSoldiers(simulation, false).filter(entry => entry.soldier.combat?.queue === undefined);
  for (let first = 0; first < free.length && enemies.length; first += TARGET_SQUAD) {
    const squad = free.slice(first, first + TARGET_SQUAD), nearest = nearestEnemy(enemies, squad[0]!.body);
    const ids = squad.map(entry => entry.soldier.actor), { x, z } = nearest.body;
    const steps = [{ kind: "ground", mode: "attackMove", x, z }, { kind: "target", uid: nearest.soldier.actor, x, z },
      { kind: "ground", mode: "attackMove", ...ENEMY_CAMP }] as const;
    for (const step of steps) if (simulation.queueMilitaryOrder(ids, step).ok) queuedSteps++;
  }
};

const deployPlayer = (simulation: SettlementSimulation) => {
  simulation.receiveTroops(forceTroops(typicalForce(SIDE, { archers: true })));
  simulation.callOutMilitary([...TYPES], PLAYER_RALLY);
  for (let second = 0; second < 120; second++) simulation.update(1);
};

const spawnEnemies = (simulation: SettlementSimulation) => {
  const troops = forceTroops(typicalForce(SIDE, { archers: true }));
  // Large armies (SIZE > 96, e.g. the 150 vs 150 targetMilitary check) spawn in wider rows to fit the camp.
  const columns = SIDE > 96 ? 14 : 8;
  return troops.map((troop, index) => spawnAround(simulation, { x: ENEMY_CAMP.x + (index % columns) * 1.2 - 4,
    z: ENEMY_CAMP.z + Math.floor(index / columns) * 1.2 - 4 }, troop.type));
};

const closestPair = (simulation: SettlementSimulation) => {
  const ours = fieldSoldiers(simulation, false), theirs = fieldSoldiers(simulation, true);
  let best = Infinity;
  for (const a of ours) for (const b of theirs) best = Math.min(best, Math.hypot(a.body.x - b.body.x, a.body.z - b.body.z));
  return best;
};

/** Distance from the field soldier nearest to the sea to the shore of the coastal strip. */
const nearestShore = (simulation: SettlementSimulation) => {
  const soldiers = [...fieldSoldiers(simulation, false), ...fieldSoldiers(simulation, true)];
  return soldiers.reduce((best, entry) =>
    Math.min(best, COAST_HALF_DEPTH - Math.abs(entry.body.z - PLAYER_RALLY.z)), Infinity);
};

/** Closest approach of the armies and (coastal) of any soldier to the shore, over the sampled battle. */
const createBattleTracker = (simulation: SettlementSimulation, coastal: boolean) => {
  let closest = Infinity, shore = Infinity;
  return {
    closest: () => closest,
    sample: () => {
      closest = Math.min(closest, closestPair(simulation));
      if (coastal) shore = Math.min(shore, nearestShore(simulation));
      return closest;
    },
    shore: () => shore
  };
};

/** JSON and table forms of a distance that does not exist (an army wiped out, no coast): `null` and `-`. */
const finiteOrNull = (distance: number) => Number.isFinite(distance) ? distance : null;
const describeDistance = (distance: number) => Number.isFinite(distance) ? distance.toFixed(1) : "-";

/** An armed enemy pair within 24 tiles where both stand idle with no target: the battle stalled. */
const stalledPairs = (simulation: SettlementSimulation) => {
  const idle = (entry: ReturnType<typeof fieldSoldiers>[number]) => entry.body.action === "idle" &&
    entry.body.pathIndex >= entry.body.path.length && entry.soldier.combat?.pendingTarget === undefined;
  const ours = fieldSoldiers(simulation, false).filter(idle), theirs = fieldSoldiers(simulation, true).filter(idle);
  return ours.reduce((count, a) => count + theirs.filter(b =>
    Math.hypot(a.body.x - b.body.x, a.body.z - b.body.z) <= STALL_RANGE).length, 0);
};

const tickSummary = (values: readonly number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const avg = sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1);
  return { avg, max: sorted.at(-1) ?? 0, p95: sorted[Math.floor(sorted.length * .95)] ?? 0 };
};

const stats = (values: readonly number[]) => {
  const { avg, max, p95 } = tickSummary(values);
  return [avg, p95, max].map(value => value.toFixed(2)).join(" | ");
};

/**
 * Wall ms per tick of the commander's decision phase and of the marches it orders (`commander.march`), and of
 * the A14-2 morale and the faction knowledge phases (every tick).
 */
const recordCommanderSpans = () => {
  const decide: number[] = [], march: number[] = [], morale: number[] = [], knowledge: number[] = [];
  let open: "decide" | "knowledge" | "march" | "morale" | null = null, openedAt = 0, decideMs = 0, marchMs = 0,
    moraleMs = 0, knowledgeMs = 0, seen = false;
  const close = () => {
    const elapsed = performance.now() - openedAt;
    if (open === "decide") decideMs += elapsed;
    if (open === "march") marchMs += elapsed;
    if (open === "morale") moraleMs += elapsed;
    if (open === "knowledge") knowledgeMs += elapsed;
    open = null;
  };
  const recorder: TickPhaseRecorder = {
    endTick: () => {
      close();
      if (seen) { decide.push(decideMs); march.push(marchMs); }
      morale.push(moraleMs);
      knowledge.push(knowledgeMs);
      decideMs = 0; marchMs = 0; moraleMs = 0; knowledgeMs = 0; seen = false;
    },
    mark: phase => {
      close();
      if (phase === COMMANDER_PHASE) open = "decide";
      if (phase === COMMANDER_MARCH_PHASE) open = "march";
      seen ||= open !== null;
      if (phase === MORALE_PHASE) open = "morale";
      if (phase === KNOWLEDGE_PHASE) open = "knowledge";
      openedAt = performance.now();
    }
  };
  return { decide, knowledge, march, morale, recorder };
};

const spanSummary = (spans: readonly number[]) => {
  const sorted = spans.slice().sort((a, b) => a - b);
  const at = (values: readonly number[], share: number) => values[Math.floor(values.length * share)] ?? 0;
  const decisions = sorted.slice(sorted.length - Math.ceil(sorted.length / DECISION_TICKS));
  const avg = sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1);
  return { avg, decisionP50: at(decisions, .5), decisionP95: at(decisions, .95), max: sorted.at(-1) ?? 0 };
};

const describeSpans = (name: string, spans: readonly number[]) => {
  const { avg, decisionP50, decisionP95, max } = spanSummary(spans);
  return `${name} ms avg/tick ${avg.toFixed(4)}, decision p50 ${decisionP50.toFixed(3)}, ` +
    `decision p95 ${decisionP95.toFixed(3)}, max ${max.toFixed(3)}`;
};

const runBattle = (label: string, coastal: boolean) => {
  const simulation = createBalanceSimulation(MAP, 7, { x: 10.5, z: 48.5 }, coastal ? carveCoast : undefined);
  deployPlayer(simulation);
  const enemies = spawnEnemies(simulation);
  simulation.commandMilitaryOpponent(enemies, PLAYER_RALLY, 1, "attackMove");
  simulation.commandMilitary(fieldSoldiers(simulation, false).map(entry => entry.soldier.actor), ENEMY_CAMP, "attackMove");
  const all: number[] = [], contact: number[] = [];
  const commander = recordCommanderSpans();
  if (PROFILE_PHASES) setTickPhaseRecorder(commander.recorder);
  const tracker = createBattleTracker(simulation, coastal);
  let contactTick: number | null = null, endSecond = SECONDS;
  for (let tick = 0; tick < SECONDS / TICK; tick++) {
    if (tick % SAMPLE_TICKS === 0 && tracker.sample() < CONTACT_RANGE) contactTick ??= tick;
    if (TARGET_UNITS && contactTick !== null && (tick - contactTick) % TARGET_EVERY_TICKS === 0)
      targetNearestEnemies(simulation);
    if (QUEUE_ORDERS && contactTick !== null && (tick - contactTick) % TARGET_EVERY_TICKS === 0)
      queueSquadOrders(simulation);
    const started = performance.now();
    simulation.update(TICK);
    const elapsed = performance.now() - started;
    all.push(elapsed);
    if (contactTick !== null && tick - contactTick < CONTACT_SECONDS / TICK) contact.push(elapsed);
    if (tick % 20 === 0 && (!fieldSoldiers(simulation, true).length || !fieldSoldiers(simulation, false).length)) {
      endSecond = tick * TICK; break;
    }
  }
  const endPair = closestPair(simulation);
  const survivors = { enemy: fieldSoldiers(simulation, true).length, player: fieldSoldiers(simulation, false).length };
  console.log(`| ${label} | ${SIDE} vs ${SIDE} | ${stats(contact)} | ` +
    `${stats(all)} | ${endSecond.toFixed(0)} s | ${survivors.player} / ${survivors.enemy} | ` +
    `${stalledPairs(simulation)} | ${describeDistance(tracker.closest())} / ${describeDistance(endPair)} | ` +
    `${describeDistance(tracker.shore())} |`);
  setTickPhaseRecorder(null);
  const hash = PROFILE_PHASES ? hashText(canonicalJson(simulation.saveState())) : undefined;
  emitBenchJson({ [coastal ? "coastal" : "flat"]: {
    battle: tickSummary(all), closestPair: { end: finiteOrNull(endPair), min: finiteOrNull(tracker.closest()) },
    contact: tickSummary(contact), endSecond, hash, nearestShore: finiteOrNull(tracker.shore()), survivors,
    ...PROFILE_PHASES && { commander: spanSummary(commander.decide), knowledge: tickSummary(commander.knowledge),
      march: spanSummary(commander.march), morale: tickSummary(commander.morale) }
  } });
  if (!PROFILE_PHASES) return;
  console.log(`  ${label}: ${describeSpans("commander", commander.decide)}; ` +
    `${describeSpans("commander.march", commander.march)} (${commander.decide.length} ticks); ` +
    `morale ms avg/tick ${(commander.morale.reduce((sum, value) => sum + value, 0) / (commander.morale.length || 1))
      .toFixed(4)}, p95 ${stats(commander.morale).split(" | ")[1]}; save hash ${hash}`);
};

console.log("| Map | Armies | Contact avg ms | Contact p95 | Contact max | Battle avg | Battle p95 | Battle max |" +
  " End | Survivors (player / enemy) | Stalled pairs | Closest pair (min / end) | Nearest shore |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
runBattle("flat", false);
// FLAT_ONLY=1: the coastal strip cannot hold the large armies of the targetMilitary check.
if (process.env.FLAT_ONLY !== "1") runBattle("coastal strip", true);
if (QUEUE_ORDERS) console.log(`QUEUE=1: ${queuedSteps} queued steps accepted`);
