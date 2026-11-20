import { createCommanderClocks } from "./commander/commander-clock";
import { createSquadOrders, type SquadDispatch } from "./commander/commander-orders";
import { createFocusChooser } from "./commander/commander-focus";
import { createPositionChooser } from "./commander/commander-position-choice";
import { createRetreatBudget } from "./commander/commander-retreat-budget";
import { createStrikeHold, isCommittedFlank } from "./commander/commander-strike-hold";
import { createRoleOrders, type RoleGroupOutcome,roleModeOf } from "./commander/commander-role-orders";
import { createSquadMemories, rememberDecision, type SquadMemorySave } from "./commander/commander-squad-memory";
import { createSquadViews } from "./commander/commander-squad-view";
import { centreOf, createSquadFormer, strengthOf } from "./commander/commander-squads";
import { type CommanderTraceRecord, isCommanderTraceActive, traceCommanderDecision } from "./commander/commander-trace";
import type {
  CommanderAction,
  CommanderDecision,
  CommanderProfile,
  CommanderGroupDecision,
  CommanderUnit,
  MilitaryCommanderOptions,
  RoleGroupMemory,
  SquadMemory,
  SquadOrder
} from "./commander/commander-types";
import { bestAction, scoreActions } from "./commander/commander-utility";
import { isVisionProbeActive, probeUnitRead } from "./faction-vision-probe";
import { createCommanderObjectives } from "./military-commander-objectives";
import { createInfluenceMap, fillInfluence, INFLUENCE_CELL, influenceBalance } from "./military-influence-map";
import { createMilitarySpatialGrid } from "./military-spatial-grid";
import type { SettlementPoint } from "./settlement-types";

export { formSquads } from "./commander/commander-squads";
export type { CommanderUnit, SquadView } from "./commander/commander-types";
export { bestAction, scoreActions } from "./commander/commander-utility";

/**
 * Smart commander (military AI mode 4, docs/archive/dated/military-motion-2026-10-13.md section 8): an influence
 * map and a utility AI lead the computer side (colony raiders and adventure camps). Once per decision
 * interval each computer faction groups its field soldiers into squads and scores four actions per squad
 * from the army strengths and positions: attack the nearest enemy, defend (hold its camp), retreat to the
 * safest ground nearby, regroup round its centre. A faction's profile only changes the weights and the
 * interval. The orders go through the same march orders as the player's (flow fields and formations), so
 * it stays fair. Deterministic: squads in uid order, no randomness.
 *
 * The parts live in `commander/`: clocks, squad forming, squad view, utility scores, orders, retreat
 * budget, squad memory and the decision trace. This module wires them into one decision per due faction.
 */

/** The debug overlay shows at most this many squad decisions. */
const DEBUG_DECISIONS = 128;
/** Plan §8 quota: squads that decide per faction decision (the rest keep their orders until their turn). */
export const MAX_SQUADS_PER_DECISION = 16;

/** The index of the first squad whose id follows `cursor` (squads are in id order); 0 to wrap or start. */
const firstAfter = (squads: readonly (readonly CommanderUnit[])[], cursor: number | undefined) => {
  if (cursor === undefined) return 0;
  const index = squads.findIndex((squad) => squad[0]!.uid > cursor);
  return index < 0 ? 0 : index;
};

/** Probe only: the deciding faction's influence map holds the strength and cell of every enemy in its view. */
const probeInfluence = (faction: number, units: readonly CommanderUnit[]) => {
  for (const unit of units) if (unit.faction !== faction) probeUnitRead("commander.influence", faction, unit);
};

/** Reports a squad decision to the trace: one record for the whole squad, or one per role group (A14-1). */
const traceSquad = (
  record: CommanderTraceRecord,
  target: SquadOrder | undefined,
  dispatch: Readonly<SquadDispatch> | undefined,
  groups: readonly RoleGroupOutcome[]
) => {
  if (dispatch) {
    traceCommanderDecision({ ...record, order: target?.order, ordered: dispatch.ordered, outcome: dispatch.outcome });
    return;
  }
  for (const { group, order, ordered, outcome } of groups)
    traceCommanderDecision({
      ...record,
      order,
      ordered,
      outcome,
      role: group.role,
      target: group.point,
      troop: group.type
    });
};

const groupDecisionOf = ({ group, moraleRelief, outcome }: RoleGroupOutcome): CommanderGroupDecision => ({
  issued: outcome === "issued",
  moraleRelief,
  strike: group.strike !== undefined,
  role: group.role,
  target: group.point,
  troop: group.type
});

/** Removes the decisions of the factions that decide again (in place, order kept). */
const dropDecisionsOf = (decisions: CommanderDecision[], factions: readonly number[]) => {
  let kept = 0;
  for (const decision of decisions) if (!factions.includes(decision.faction)) decisions[kept++] = decision;
  decisions.length = kept;
};

type SquadViewOf = ReturnType<ReturnType<typeof createSquadViews>["forFaction"]>;

/** The memory of a striking group held out of a retreat (A14-2), as the squad's only group. */
const heldGroups = (group: RoleGroupMemory | undefined) => group && [group];

/**
 * The squad's last decision: under its id, else (its first member left, e.g. fell back) the one of the first
 * member's previous squad, so a re-formed squad keeps its order instead of counting as new.
 */
const squadMemoryOf = (squad: readonly CommanderUnit[], previous: ReadonlyMap<number, SquadMemory> | undefined) => {
  const own = previous?.get(squad[0]!.uid);
  if (own || !previous) return own;
  for (const unit of squad) {
    const inherited = unit.squad === undefined ? undefined : previous.get(unit.squad);
    if (inherited) return inherited;
  }
  return undefined;
};

export const createMilitaryCommander = (options: MilitaryCommanderOptions) => {
  const map = createInfluenceMap(options.cellsX, options.cellsZ);
  const nearbyUnits = createMilitarySpatialGrid<CommanderUnit>(options.cellsX, options.cellsZ);
  const memories = createSquadMemories();
  const clocks = createCommanderClocks(options);
  const budget = createRetreatBudget();
  const objectives = createCommanderObjectives();
  const views = createSquadViews({ budget, map, nearbyUnits });
  const orders = createSquadOrders({
    command: options.command,
    isClear: options.isClear,
    map,
    nearbyUnits,
    objectives
  });
  const chooser = createPositionChooser({
    heightAt: options.heightAt,
    isClear: options.isClear,
    knowsByAlertOnly: options.knowsByAlertOnly,
    map,
    nearbyUnits
  });
  const roleOrders = createRoleOrders({ chooser, send: orders.send, strikeBegins: options.strikeBegins });
  const strikeHold = createStrikeHold(chooser);
  const formSquads = createSquadFormer();
  const chooseFocus = createFocusChooser(nearbyUnits);
  const decisions: CommanderDecision[] = [];
  /** Reused per decision: the deciding faction's free soldiers, and the uids in the field. */
  const own: CommanderUnit[] = [],
    presentUids = new Set<number>();
  /** Per faction: the id of the last squad that decided while the quota held (saved). */
  const cursors = new Map<number, number>();
  let viewed = 1;

  /**
   * A14-2 focus: each role group of an attacking or defending squad focuses on its most dangerous known foe;
   * a whole squad that attacks or defends focuses as its first member's type; retreat and regroup clear it.
   */
  const assignFocus = (faction: number, squad: readonly CommanderUnit[], action: CommanderAction,
    byRoles: boolean, centre: SettlementPoint) => {
    const setFocus = options.setFocus;
    if (!setFocus) return;
    if (action === "retreat" || action === "regroup") {
      setFocus(squad, undefined);
      return;
    }
    if (!byRoles) {
      setFocus(squad, chooseFocus(faction, squad[0]!.type, centre));
      return;
    }
    for (const group of roleOrders.groups())
      setFocus(group.members, chooseFocus(faction, group.type, centreOf(group.members)));
  };

  /** One squad's decision: action, orders (by role groups or whole), focus, memory, debug and trace. */
  const decideSquad = (faction: number, squad: readonly CommanderUnit[], profile: CommanderProfile,
    viewOf: SquadViewOf, previous: ReadonlyMap<number, SquadMemory> | undefined, next: Map<number, SquadMemory>) => {
    const id = squad[0]!.uid,
      memory = squadMemoryOf(squad, previous),
      context = viewOf(squad, memory);
    options.setSquad?.(squad, id);
    const scores = scoreActions(context.view, profile.weights, profile.moraleUse);
    const committed = isCommittedFlank(squad, memory, profile.decisionInterval, chooser.hasPreyNear);
    const action = committed ? "attack" : bestAction(scores),
      target = orders.targetOf(action, faction, context, memory);
    const mode = roleModeOf(action, context, target);
    const byRoles = mode !== undefined &&
      roleOrders.decide(faction, squad, action, mode, context, target, memory, profile.roleUse);
    const held = byRoles ? undefined : strikeHold(squad, action, memory, profile.decisionInterval);
    const dispatch = held?.retreating.length ? orders.execute(held.retreating, action, target, memory) : undefined;
    assignFocus(faction, held?.retreating ?? squad, action, byRoles, context.centre);
    budget.record(squad, action, context.view, profile.decisionInterval);
    const point = target?.point;
    const groups = byRoles ? roleOrders.outcomes.map((outcome) => outcome.group) : heldGroups(held?.group);
    next.set(id, rememberDecision(memory, action, point, groups));
    decisions.push({
      action,
      centre: context.centre,
      faction,
      groups: byRoles ? roleOrders.outcomes.map(groupDecisionOf) : undefined,
      issued: dispatch ? dispatch.outcome === "issued" : undefined,
      members: squad.length,
      score: scores[action],
      scores,
      squad: id,
      target: point
    });
    if (!isCommanderTraceActive()) return;
    const record: CommanderTraceRecord = {
      action,
      centre: context.centre,
      faction,
      members: squad.length,
      ordered: 0,
      outcome: "unchanged",
      resuming: target?.resuming ?? false,
      scores,
      squad: id,
      target: point,
      view: context.view
    };
    traceSquad(record, target, dispatch, byRoles ? roleOrders.outcomes : []);
  };

  /**
   * At most `MAX_SQUADS_PER_DECISION` squads decide (plan §8 quota): beyond it a rolling cursor by squad id
   * starts after the last squad that decided, and the other squads keep their last order and memory.
   */
  const decide = (faction: number, units: readonly CommanderUnit[]) => {
    const profile = options.profile(faction),
      viewOf = views.forFaction(faction);
    const previous = memories.of(faction),
      next = memories.open(faction);
    own.length = 0;
    for (const unit of units) if (unit.faction === faction && !unit.busy) own.push(unit);
    for (const unit of own) objectives.observe(unit);
    roleOrders.begin(faction);
    orders.begin();
    const squads = formSquads(own);
    const first = squads.length > MAX_SQUADS_PER_DECISION ? firstAfter(squads, cursors.get(faction)) : 0;
    for (let index = 0; index < squads.length; index++) {
      const squad = squads[(first + index) % squads.length]!;
      if (index < MAX_SQUADS_PER_DECISION) {
        decideSquad(faction, squad, profile, viewOf, previous, next);
        continue;
      }
      const kept = previous?.get(squad[0]!.uid);
      if (kept) next.set(squad[0]!.uid, kept);
    }
    if (squads.length > MAX_SQUADS_PER_DECISION)
      cursors.set(faction, squads[(first + MAX_SQUADS_PER_DECISION - 1) % squads.length]![0]!.uid);
    else cursors.delete(faction);
    memories.commit(faction, next);
  };

  /** The squad grid and the influence map over the soldiers a faction perceives. */
  const perceiveAll = (units: readonly CommanderUnit[]) => {
    nearbyUnits.rebuild(units);
    fillInfluence(map, units, strengthOf);
  };
  /** One faction decides over its own view (A13 phase 3: its map holds only what it knows). */
  const decideOver = (faction: number, view: readonly CommanderUnit[]) => {
    perceiveAll(view);
    if (isVisionProbeActive()) probeInfluence(faction, view);
    decide(faction, view);
  };
  /** Without a perception every due faction decides over one map of all soldiers. */
  const decideOverAll = (due: readonly number[], units: readonly CommanderUnit[]) => {
    perceiveAll(units);
    for (const faction of due) {
      if (isVisionProbeActive()) probeInfluence(faction, units);
      decide(faction, units);
    }
  };
  /** Forgets the soldiers that left the field. */
  const keepPresent = (units: readonly CommanderUnit[]) => {
    presentUids.clear();
    for (const unit of units) presentUids.add(unit.uid);
    budget.keep(presentUids);
    objectives.keep(presentUids);
  };
  /** Once per tick: each computer faction decides once per decision interval of its profile. */
  const update = (dt: number) => {
    const present = clocks.present();
    const due = clocks.advance(present, dt);
    if (!due.length) return;
    const units = options.units();
    dropDecisionsOf(decisions, due);
    if (options.perceive) for (const faction of due) decideOver(faction, options.perceive(faction, units));
    else decideOverAll(due, units);
    keepPresent(units);
    viewed = present[0] ?? 1;
  };
  const clear = () => {
    memories.clear();
    clocks.clear();
    budget.clear();
    objectives.clear();
    cursors.clear();
    decisions.length = 0;
  };
  return {
    update,
    save: (): MilitaryCommanderSave => ({
      memories: memories.save(),
      clocks: clocks.save(),
      retreating: budget.save(),
      objectives: objectives.save(),
      ...(cursors.size ? { cursors: [...cursors].sort(([first], [second]) => first - second) } : {})
    }),
    restore: (saved: MilitaryCommanderSave | undefined) => {
      decisions.length = 0;
      memories.restore(saved?.memories);
      clocks.restore(saved?.clocks);
      budget.restore(saved?.retreating);
      objectives.restore(saved?.objectives);
      cursors.clear();
      for (const [faction, squad] of saved?.cursors ?? []) cursors.set(faction, squad);
    },
    /** Debug overlay: the influence balance of the first computer side and every squad's decision. */
    debug: () => ({
      cell: INFLUENCE_CELL,
      columns: map.columns,
      decisions: decisions.slice(0, DEBUG_DECISIONS).map((decision) => ({ ...decision })),
      faction: viewed,
      influence: Array.from(influenceBalance(map, viewed)),
      rows: map.rows
    }),
    clear
  };
};

export interface MilitaryCommanderSave {
  memories: SquadMemorySave;
  clocks: [number, number][];
  retreating: [number, number][];
  objectives: ReturnType<ReturnType<typeof createCommanderObjectives>["save"]>;
  /** A14-2 squad quota: per faction, the last squad id that decided (absent: every squad decides). */
  cursors?: [number, number][];
}
