import { MAX_FORCES, MAX_INTENTS, RAID_PARTY_MAX } from "../../balance/commander-director";
import { MILITARY_PROFILES } from "../../balance/military";
import type { SettlementPoint } from "../settlement-types";
import { armyRequestsOf } from "./army-requests";
import type { CommanderUnit } from "./commander-types";
import { distance, type ForceView, strengthPoints } from "./director-forces";
import type { MacroInputs } from "./director-macros";
import type { MethodOutcome } from "./director-methods";
import {
  type DirectorFaction, type DirectorForce, type DirectorMacro, type DirectorTarget, DISMISSED_INTENT
} from "./director-types";
import {
  copyIntent, INTENT_MACROS, intentArea, type IntentReceipt, intentSite, type IntentState, type IntentStatus,
  isFinished, isStrategicIntent, MACRO_INTENTS, sameIntent, type StrategicIntent
} from "./strategic-intents";

/**
 * The economy AI's intents inside the director (A14 plan §5.4, lane A14-4c). An intent gets at most one force,
 * formed from the faction's uncommitted field soldiers in intent (priority) order; its force may only run the
 * intent's macro (or withdraw / regroup, the director's own field decisions). An attack or raid on a site the
 * faction has not seen is rejected and scouted until the site is known. Everything here runs at the faction's
 * director decision; a faction without intents never enters this module.
 */

/** What the director's force handling offers the intents. */
export interface IntentDeps {
  knowsSite: (faction: number, uid: number) => boolean;
  /** A place to withdraw to for a force forming round `near` (an own building's entrance, else `near`). */
  homeOf: (faction: number, near: SettlementPoint) => SettlementPoint;
  scoutGoals: (faction: number, from: SettlementPoint) => readonly SettlementPoint[];
  /** A soldier in no force that may be ordered. */
  isFree: (unit: CommanderUnit) => boolean;
  /** Forms a mustering force of these soldiers (undefined when refused). */
  form: (
    faction: number, ids: readonly number[], home: SettlementPoint, towards: SettlementPoint | undefined,
    perception: readonly CommanderUnit[]
  ) => DirectorForce | undefined;
  /** Adds soldiers to a force and sends them to its staging point. */
  enlist: (faction: number, force: DirectorForce, ids: readonly number[], strength: number) => void;
}

const OFFENSIVE: readonly DirectorMacro[] = ["strike", "raid"];
const byUid = (first: CommanderUnit, second: CommanderUnit) => first.uid - second.uid;

/** Replaces the faction's intents; a restated intent keeps its state and force, a dropped one dismisses its force. */
export const replaceIntents = (
  entry: DirectorFaction, intents: readonly StrategicIntent[], knowsSite: (uid: number) => boolean
): IntentReceipt[] => {
  const given: readonly unknown[] = intents;
  if (!given.every(isStrategicIntent)) return given.map((_, index) => ({ index, status: "failed" }));
  const previous = entry.intents ?? [], moved = new Map<number, number>();
  const states = intents.slice(0, MAX_INTENTS).map((intent, index): IntentState => {
    const kept = previous.findIndex((state, old) => !moved.has(old) && sameIntent(state.intent, intent));
    if (kept >= 0) {
      moved.set(kept, index);
      return { ...previous[kept]!, intent: copyIntent(intent) };
    }
    const site = intentSite(intent), known = site === undefined ? undefined : knowsSite(site);
    return { intent: copyIntent(intent), status: known === false ? "rejectedUnknownTarget" : "accepted",
      strength: 0, ...(known ? { known } : {}) };
  });
  for (const force of entry.forces)
    if (force.intent !== undefined) force.intent = moved.get(force.intent) ?? DISMISSED_INTENT;
  entry.intents = states;
  return intents.map((_, index) => ({ index, status: states[index]?.status ?? "failed" }));
};

/** A site intent learns whether its target is known; a known target that is no target any more has fallen. */
const refreshSite = (faction: number, state: IntentState, targets: readonly DirectorTarget[], deps: IntentDeps) => {
  const uid = intentSite(state.intent);
  if (uid === undefined || isFinished(state.status)) return;
  if (deps.knowsSite(faction, uid)) state.known = true;
  if (!state.known) {
    state.status = "rejectedUnknownTarget";
    return;
  }
  if (targets.some(target => target.uid === uid)) {
    if (state.status === "rejectedUnknownTarget") state.status = "forming";
    return;
  }
  state.status = state.status === "underway" ? "done" : "failed";
};

const isRetreating = (entry: DirectorFaction) => entry.intents?.some(state => state.intent.kind === "retreat") ?? false;

/** A force still gathering: new soldiers may join it. */
const isJoinable = (force: DirectorForce) => force.macro !== "withdraw" && force.macro !== "regroup" &&
  !(OFFENSIVE.includes(force.macro) && force.task > 0);

const fastestOf = (pool: readonly CommanderUnit[]) => {
  let best: CommanderUnit | undefined;
  for (const unit of pool)
    if (!best || MILITARY_PROFILES[unit.type].speed > MILITARY_PROFILES[best.type].speed) best = unit;
  return best;
};

/** Takes the pool's first soldiers (ascending uid) until `enough` says the picked ones suffice. */
const takeUntil = (pool: CommanderUnit[], enough: (picked: readonly CommanderUnit[], strength: number) => boolean) => {
  const picked: CommanderUnit[] = [];
  let strength = 0;
  while (pool.length && !enough(picked, strength)) {
    const unit = pool.shift()!;
    picked.push(unit);
    strength += strengthPoints(unit);
  }
  return picked;
};

const takeInArea = (pool: CommanderUnit[], area: SettlementPoint & { radius: number }) => {
  const picked = pool.filter(unit => distance(unit, area) <= area.radius);
  for (const unit of picked) pool.splice(pool.indexOf(unit), 1);
  return picked;
};

/** The soldiers an intent takes from the uncommitted pool at this decision (removed from the pool). */
const takeFor = (state: IntentState, force: DirectorForce | undefined, pool: CommanderUnit[]) => {
  const { intent } = state;
  if (force && !isJoinable(force)) return [];
  switch (intent.kind) {
    case "attack": {
      const missing = Math.max(1, intent.minStrength) - state.strength;
      return takeUntil(pool, (_, strength) => strength >= missing);
    }
    case "raid": {
      const room = RAID_PARTY_MAX - (force?.members.length ?? 0);
      return takeUntil(pool, picked => picked.length >= room);
    }
    case "scout": {
      const scout = force ? undefined : fastestOf(pool);
      if (!scout) return [];
      pool.splice(pool.indexOf(scout), 1);
      return [scout];
    }
    case "retreat": return [];
    default: return takeInArea(pool, intent.area);
  }
};

const pointOf = ({ x, z }: SettlementPoint): SettlementPoint => ({ x, z });

const centreOf = (units: readonly CommanderUnit[]): SettlementPoint => {
  let x = 0, z = 0;
  for (const unit of units) { x += unit.x; z += unit.z; }
  return { x: x / units.length, z: z / units.length };
};

/** Forms the intent's force: a post stands in its area; any other force musters towards its target. */
const formFor = (
  entry: DirectorFaction, index: number, picked: readonly CommanderUnit[], targets: readonly DirectorTarget[],
  perception: readonly CommanderUnit[], deps: IntentDeps
) => {
  const { faction } = entry, { intent } = entry.intents![index]!, area = intentArea(intent);
  const ids = picked.map(unit => unit.uid);
  const posted = intent.kind === "defend" || intent.kind === "hold";
  const home = posted ? pointOf(intent.area) : deps.homeOf(faction, centreOf(picked));
  const site = intentSite(intent), target = targets.find(entry => entry.uid === site);
  const towards = posted ? undefined : target ?? area ?? deps.scoutGoals(faction, home)[0];
  const force = deps.form(faction, ids, home, towards, perception);
  if (!force) return;
  force.intent = index;
  if (posted) force.radius = intent.area.radius;
  else if (area && intent.kind !== "scout") force.goal = pointOf(area);
};

/**
 * Before the forces decide: site intents learn what is known, then every unfinished intent takes soldiers
 * from the faction's uncommitted field soldiers, in intent order (none while a retreat is ordered).
 */
export const commitIntents = (
  entry: DirectorFaction, targets: readonly DirectorTarget[], perception: readonly CommanderUnit[], deps: IntentDeps
) => {
  const states = entry.intents!, { faction } = entry;
  for (const state of states) refreshSite(faction, state, targets, deps);
  if (isRetreating(entry)) return;
  const pool = perception.filter(unit => unit.faction === faction && deps.isFree(unit)).sort(byUid);
  for (let index = 0; index < states.length && pool.length; index++) {
    const state = states[index]!;
    if (isFinished(state.status)) continue;
    const force = entry.forces.find(item => item.intent === index);
    if (!force && entry.forces.length >= MAX_FORCES) continue;
    const picked = takeFor(state, force, pool);
    if (!picked.length) continue;
    const strength = picked.reduce((sum, unit) => sum + strengthPoints(unit), 0);
    if (force) deps.enlist(faction, force, picked.map(unit => unit.uid), strength);
    else formFor(entry, index, picked, targets, perception, deps);
  }
};

/** What a force's intent orders at this decision. */
export interface IntentOrder {
  /** The force's intent (absent: dismissed, or a force of the director's own under a retreat). */
  state?: IntentState;
  /** The only macro the force may pick freely. */
  macro: DirectorMacro;
  /** The known site it strikes or raids. */
  target?: number;
  /** An attack's strength goal for the muster. */
  musterGoal?: number;
  /** A scout intent's own goal. */
  scoutGoal?: SettlementPoint;
}

const WITHDRAW: IntentOrder = Object.freeze({ macro: "withdraw" });

/** The order of a force (undefined: the force decides freely, as without intents). */
export const orderOf = (entry: DirectorFaction, force: DirectorForce): IntentOrder | undefined => {
  if (!entry.intents) return undefined;
  if (force.intent === undefined) return isRetreating(entry) ? WITHDRAW : undefined;
  const state = entry.intents[force.intent];
  if (!state || isRetreating(entry)) return WITHDRAW;
  if (isFinished(state.status)) return { macro: "withdraw", state };
  const { intent } = state;
  if (state.status === "rejectedUnknownTarget") return { macro: "scout", state };
  return {
    macro: INTENT_MACROS[intent.kind], state,
    ...(intent.kind === "attack" ? { musterGoal: intent.minStrength } : {}),
    ...(intent.kind === "scout" && intent.area ? { scoutGoal: pointOf(intent.area) } : {}),
    target: intentSite(intent)
  };
};

/** What one decision of an intent's force showed. */
export interface IntentOutcome {
  force: DirectorForce;
  view: ForceView;
  inputs: MacroInputs;
  outcome: MethodOutcome;
  /** The force's method gave the macro up for a withdrawal (a raid's time or losses, a strike without target). */
  switched: boolean;
}

const arrived = ({ force, inputs, view }: IntentOutcome, state: IntentState) => {
  const area = intentArea(state.intent);
  return area !== undefined && force.task > 0 && !inputs.contact && distance(view.centre, area) <= area.radius;
};

const progressOf = (state: IntentState, result: IntentOutcome) => {
  const { force, outcome, switched } = result, { kind } = state.intent;
  if (force.macro === "withdraw") return switched ? "done" : "failed";
  if (state.status === "rejectedUnknownTarget") return state.status;
  if (kind === "defend" || kind === "hold") return "underway";
  if (kind === "scout") {
    if (outcome === "done") return "done";
    return force.macro === "scout" ? "underway" : "forming";
  }
  if (!OFFENSIVE.includes(force.macro) || force.task === 0) return "forming";
  return kind === "attack" && arrived(result, state) ? "done" : "underway";
};

/** After an intent force's decision: the intent's committed strength and status. */
export const reportIntent = (state: IntentState, result: IntentOutcome) => {
  state.strength = result.view.strength;
  state.force = result.force.id;
  if (!isFinished(state.status)) state.status = progressOf(state, result);
};

/**
 * True the first time an attack or raid intent is under way (its force has set out): the script event
 * `factionAttackLaunched` fires then, once per intent (`launched` is saved; a restated intent keeps it).
 */
export const markIntentLaunched = (state: IntentState) => {
  const { kind } = state.intent;
  if (state.launched || state.status !== "underway" || (kind !== "attack" && kind !== "raid")) return false;
  state.launched = true;
  return true;
};

/** An unfinished intent whose force is gone: a post forms again; an attack, raid or scout party is lost. */
const settleForceless = (entry: DirectorFaction, state: IntentState) => {
  const { kind } = state.intent, lostForce = state.force !== undefined;
  state.strength = 0;
  state.force = undefined;
  if (isFinished(state.status)) return;
  if (kind === "retreat") state.status = entry.forces.length ? "underway" : "done";
  else if (lostForce && kind !== "defend" && kind !== "hold") state.status = "failed";
  else if (state.status !== "rejectedUnknownTarget") state.status = "forming";
};

/** After the forces decided: forceless intents settle and the army requests are recomputed (plan §5.4). */
export const settleIntents = (entry: DirectorFaction, perception: readonly CommanderUnit[]) => {
  const states = entry.intents!;
  let shortfall = 0, lost = 0;
  states.forEach((state, index) => {
    const force = entry.forces.find(item => item.intent === index);
    if (force) lost += Math.max(0, force.start - state.strength);
    else settleForceless(entry, state);
    if (state.intent.kind === "attack" && !isFinished(state.status) && state.status !== "underway")
      shortfall += Math.max(0, state.intent.minStrength - state.strength);
  });
  const requests = armyRequestsOf({ faction: entry.faction, lost, perception, shortfall });
  entry.requests = requests.length ? requests : undefined;
};

/** The statuses of a faction: its intents', or (no economy AI) the default intents its own forces stand for. */
export const intentStatuses = (entry: DirectorFaction | undefined, strengthOf: (force: DirectorForce) => number) => {
  if (!entry) return [];
  if (entry.intents)
    return entry.intents.map((state, index): IntentStatus => ({ index, kind: state.intent.kind,
      status: state.status, strength: state.strength, ...(state.force === undefined ? {} : { force: state.force }) }));
  return entry.forces.map((force, index): IntentStatus => ({ force: force.id, index, kind: MACRO_INTENTS[force.macro],
    status: OFFENSIVE.includes(force.macro) && force.task === 0 ? "forming" : "underway",
    strength: strengthOf(force) }));
};
