import { MAX_FORCES } from "../../balance/commander-director";
import type { SettlementPoint } from "../settlement-types";
import type { CommanderProfile, CommanderUnit } from "./commander-types";
import { dueFaction, firstDueTick, scheduleNext } from "./director-clock";
import { chooseStaging, strengthPoints, viewForce } from "./director-forces";
import { readForce } from "./director-inputs";
import {
  commitIntents, type IntentDeps, intentStatuses, markIntentLaunched, orderOf, replaceIntents, reportIntent,
  settleIntents
} from "./director-intents";
import { chooseMacro, orderScores, scoreMacros } from "./director-macros";
import { type MethodOutcome, runMethod } from "./director-methods";
import { copyDirector } from "./director-save";
import { isDirectorTraceActive, traceDirectorDecision } from "./director-trace";
import type {
  DirectorFaction, DirectorForce, DirectorForceStatus, DirectorKnowledge, DirectorMacro, DirectorMember,
  DirectorOrders, DirectorSave, DirectorTarget, ForceHandover, ForceKind, ForceLaunch, MilitaryDirectorPort
} from "./director-types";
import { type CommanderStrategicApi, intentSite, type StrategicIntent } from "./strategic-intents";

export interface MilitaryDirectorOptions {
  now: () => number;
  /** A soldier of `faction` that may join a force (alive, of that faction), wherever it stands. */
  enlists: (uid: number, faction: number) => boolean;
  /** A member in the field (undefined: gone, fallen or back inside a building). */
  member: (uid: number, faction: number) => DirectorMember | undefined;
  knowledge: DirectorKnowledge;
  orders: DirectorOrders;
  /** The faction's commander profile (its director interval, ratios and uncertainty margin; plan §7). */
  profile: (faction: number) => CommanderProfile;
  /** Every soldier of the faction, in the field or in a building (any order). */
  soldiers: (faction: number) => readonly number[];
  /** Where a force forming round `near` withdraws to (an own building's entrance, else `near`). */
  homeOf: (faction: number, near: SettlementPoint) => SettlementPoint;
  /**
   * A force of the faction sets out to attack (EAI4c, the script event `factionAttackLaunched`): a permit is
   * launched, or an attack or raid intent is under way for the first time (`target`: the site it names).
   */
  onAttackLaunched?: (faction: number, target?: number) => void;
}

const OFFENSIVE: readonly DirectorMacro[] = ["strike", "raid"];
const byNumber = (first: number, second: number) => first - second;

/** Strength points of the faction's soldiers in the field that no force owns (`strategy.fieldStrength`). */
const fieldStrengthOf = (
  options: Pick<MilitaryDirectorOptions, "member" | "soldiers">, owned: ReadonlyMap<number, unknown>, faction: number
) => {
  let strength = 0;
  for (const uid of options.soldiers(faction)) {
    const member = owned.has(uid) ? undefined : options.member(uid, faction);
    if (member) strength += strengthPoints(member);
  }
  return strength;
};

/**
 * The strategic director (A14 plan §5, lane A14-4a): per computer faction ≤ 3 forces, one macro each, chosen
 * once per director interval of the faction's profile (medium 6 s) on the faction's slot from what the faction
 * knows, run by fixed methods (`director-methods.ts`).
 * Forces come from permits (colony counterattacks, scripted waves) and from the economy AI's intents
 * (`director-intents.ts`, A14-4c); without intents a faction's forces decide freely, as its defaults.
 * Deterministic: factions, forces and members ascend; integer strengths; no randomness; all state saved.
 */
export const createMilitaryDirector = (options: MilitaryDirectorOptions) => {
  let factions: DirectorFaction[] = [];
  const handovers = new Map<ForceKind, ForceHandover>();
  /** Member uid → its force (derived from the saved forces). */
  const owned = new Map<number, DirectorForce>();

  const reindex = () => {
    owned.clear();
    for (const entry of factions)
      for (const force of entry.forces) for (const uid of force.members) owned.set(uid, force);
  };

  const presentMembers = (faction: number, force: DirectorForce) => {
    const members: DirectorMember[] = [];
    for (const uid of force.members) {
      const member = options.member(uid, faction);
      if (member) members.push(member);
    }
    force.members = members.map(member => member.uid);
    return members;
  };

  const factionEntry = (faction: number, now: number) => {
    let entry = factions.find(item => item.faction === faction);
    if (entry) return entry;
    const interval = options.profile(faction).directorIntervalTicks;
    entry = { faction, forces: [], next: firstDueTick(faction, now, interval), nextForce: 1 };
    factions.push(entry);
    factions.sort((a, b) => a.faction - b.faction);
    return entry;
  };

  const towardsOf = (faction: number, launch: ForceLaunch, targets: readonly DirectorTarget[]) =>
    launch.goal ?? targets[0] ?? options.knowledge.scoutGoals(faction, launch.home)[0];

  /** The first orders of a launch: a wave marches on its goal at once; any other force musters. */
  const firstOrders = (faction: number, force: DirectorForce) => force.goal
    ? options.orders.march(force.members, force.goal, faction, "attackMove")
    : options.orders.march(force.members, force.staging, faction, "move");

  /** Forms a force of `members` (ascending, free, enlisted; the caller checked the force cap). */
  const form = (
    faction: number, members: number[], request: ForceLaunch, towards: SettlementPoint | undefined,
    perception: readonly CommanderUnit[]
  ) => {
    if (!members.length) return undefined;
    const now = options.now();
    const staging = chooseStaging(faction, perception, request.home, towards, options.orders.isClear);
    const present = members.flatMap(uid => options.member(uid, faction) ?? []);
    const force: DirectorForce = { home: { x: request.home.x, z: request.home.z }, id: 0, kind: request.kind,
      macro: request.goal ? "strike" : "hold", members, since: now, staging,
      start: viewForce(present).strength, task: 0,
      ...(request.goal ? { goal: { x: request.goal.x, z: request.goal.z } } : {}) };
    if (!firstOrders(faction, force)) return undefined;
    const entry = factionEntry(faction, now);
    force.id = entry.nextForce++;
    entry.forces.push(force);
    // A wave already marches on its goal: its strike presses from the first decision on (no re-order).
    if (force.goal) force.task = 2;
    reindex();
    return force;
  };

  const enlistable = (faction: number, ids: readonly number[]) =>
    [...new Set(ids)].filter(uid => !owned.has(uid) && options.enlists(uid, faction)).sort(byNumber);

  const launch = (faction: number, ids: readonly number[], request: ForceLaunch) => {
    if (!Number.isSafeInteger(faction) || faction <= 0) return false;
    const members = enlistable(faction, ids), existing = factions.find(item => item.faction === faction);
    if (!members.length || (existing?.forces.length ?? 0) >= MAX_FORCES) return false;
    const perception = options.knowledge.perceive(faction);
    const towards = towardsOf(faction, request, options.knowledge.targets(faction));
    if (!form(faction, members, request, towards, perception)) return false;
    // A scripted wave is the script's own doing; a permit is the faction's attack.
    if (request.kind !== "wave") options.onAttackLaunched?.(faction);
    return true;
  };

  const intentDeps: IntentDeps = {
    enlist: (faction, force, ids, strength) => {
      force.members = [...force.members, ...ids].sort(byNumber);
      force.start += strength;
      for (const uid of ids) owned.set(uid, force);
      options.orders.march(ids, force.staging, faction, "move");
    },
    form: (faction, ids, home, towards, perception) =>
      form(faction, enlistable(faction, ids), { home, kind: "permit" }, towards, perception),
    homeOf: options.homeOf,
    isFree: unit => !unit.busy && !owned.has(unit.uid),
    knowsSite: options.knowledge.knowsSite,
    scoutGoals: options.knowledge.scoutGoals
  };

  const changeMacro = (force: DirectorForce, macro: DirectorMacro, now: number, target?: DirectorTarget) => {
    force.macro = macro;
    force.task = 0;
    force.since = now;
    force.scout = undefined;
    force.visited = undefined;
    if (!OFFENSIVE.includes(macro) || force.goal) return;
    force.target = target?.uid;
  };

  /** One force's decision; returns false when the force ends (released or empty). */
  const decideForce = (entry: DirectorFaction, force: DirectorForce, now: number, profile: CommanderProfile,
    targets: readonly DirectorTarget[], perception: ReturnType<DirectorKnowledge["perceive"]>) => {
    const { faction } = entry, members = presentMembers(faction, force);
    if (!members.length) return false;
    const view = viewForce(members, force.scout);
    // A force launched from inside its forts is weighed once its soldiers stand in the field.
    if (!force.start) force.start = view.strength;
    const order = orderOf(entry, force);
    if (order?.target !== undefined) force.target = order.target;
    const scoutGoal = order?.scoutGoal;
    const scoutGoals = scoutGoal ? () => [scoutGoal] : (from: SettlementPoint) =>
      options.knowledge.scoutGoals(faction, from);
    const reads = readForce(faction, force, view, perception, targets, scoutGoals(force.staging).length > 0,
      profile);
    const previous = force.macro, scores = scoreMacros(reads.inputs);
    const macro = chooseMacro(order ? orderScores(scores, order.macro, reads.inputs) : scores, force.macro);
    if (macro !== previous) changeMacro(force, macro, now, reads.candidate);
    if (macro !== previous && force.target !== undefined && reads.candidate?.uid === force.target)
      force.staging = chooseStaging(faction, perception, force.home, reads.candidate, options.orders.isClear);
    const context = { faction, force, handover: handovers.get(force.kind), members, musterGoal: order?.musterGoal,
      now, orders: options.orders, scoutGoals, targets, threat: reads.threat, view };
    let outcome: MethodOutcome = runMethod(force.macro, context);
    const switched = typeof outcome === "object";
    if (typeof outcome === "object") {
      changeMacro(force, outcome.switch, now, reads.candidate);
      outcome = runMethod(force.macro, context);
    }
    if (outcome === "done") changeMacro(force, "hold", now);
    if (order?.state) reportIntent(order.state, { force, inputs: reads.inputs, outcome, switched, view });
    if (order?.state && markIntentLaunched(order.state))
      options.onAttackLaunched?.(faction, intentSite(order.state.intent));
    if (isDirectorTraceActive())
      traceDirectorDecision({ faction, force: force.id, kind: force.kind, knownTargets: targets.length,
        macro: force.macro, members: force.members.length, previous, scout: force.scout, strength: view.strength,
        target: force.target, task: force.task, tick: now });
    return outcome !== "release" && force.members.length > 0;
  };

  const decide = (entry: DirectorFaction, now: number, profile: CommanderProfile) => {
    const targets = options.knowledge.targets(entry.faction);
    const perception = options.knowledge.perceive(entry.faction);
    if (entry.intents) commitIntents(entry, targets, perception, intentDeps);
    entry.forces = entry.forces.filter(force => decideForce(entry, force, now, profile, targets, perception));
    if (entry.intents) settleIntents(entry, perception);
    // An emptied intent list with every force released (EAI4c: a script goal ended): the defaults again.
    factions = factions.filter(item => item.forces.length > 0 || (item.intents?.length ?? 0) > 0);
    reindex();
  };

  /** Once per tick: at most one faction's director decides (its slot, plan §8). */
  const update = () => {
    if (!factions.length) return;
    const now = options.now(), entry = dueFaction(factions, now);
    if (!entry) return;
    const profile = options.profile(entry.faction);
    scheduleNext(entry, now, profile.directorIntervalTicks);
    decide(entry, now, profile);
  };

  const status = (faction: number): DirectorForceStatus[] =>
    (factions.find(item => item.faction === faction)?.forces ?? []).map(force => ({
      force: force.id, kind: force.kind, macro: force.macro, members: force.members.length,
      strength: strengthOf(faction, force),
      ...(force.target === undefined ? {} : { target: force.target })
    }));

  const strengthOf = (faction: number, force: DirectorForce) =>
    viewForce(force.members.flatMap(uid => options.member(uid, faction) ?? [])).strength;

  const strategy: CommanderStrategicApi = {
    armyRequests: faction => factions.find(item => item.faction === faction)?.requests ?? [],
    fieldStrength: faction => fieldStrengthOf(options, owned, faction),
    knownTargets: faction => options.knowledge.targets(faction),
    setIntents: (faction: number, intents: readonly StrategicIntent[]) => {
      if (!Number.isSafeInteger(faction) || faction <= 0) return [];
      return replaceIntents(factionEntry(faction, options.now()), intents,
        uid => options.knowledge.knowsSite(faction, uid));
    },
    status: faction => intentStatuses(factions.find(item => item.faction === faction),
      force => strengthOf(faction, force)),
    uncommitted: faction => options.soldiers(faction).filter(uid => !owned.has(uid)).sort(byNumber)
  };

  /** Tasks the tactical commander must not override: the scout, a muster, a regroup and a withdrawal. */
  const holds = (uid: number) => {
    const force = owned.get(uid);
    if (!force) return false;
    if (force.macro === "scout") return force.scout === uid;
    if (OFFENSIVE.includes(force.macro)) return force.task === 0 && (!force.goal || force.intent !== undefined);
    return force.macro === "regroup" || force.macro === "withdraw";
  };

  const port: MilitaryDirectorPort = {
    holds,
    launch,
    owns: uid => owned.has(uid),
    setHandover: (kind, handover) => { handovers.set(kind, handover); },
    status,
    strategy
  };
  return {
    port,
    update,
    /** No force exists (the quiet-island skip may run). */
    idle: () => factions.length === 0,
    save: (): DirectorSave | undefined => factions.length ? copyDirector({ factions }) : undefined,
    restore: (saved: DirectorSave | undefined) => {
      factions = saved ? copyDirector(saved).factions : [];
      reindex();
    },
    clear: () => {
      factions = [];
      owned.clear();
    }
  };
};

export type MilitaryDirector = ReturnType<typeof createMilitaryDirector>;
export type { DirectorOrders };
