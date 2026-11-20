import { FOCUS_RADIUS } from "../balance/commander-profiles";
import { MORALE_WAVERING } from "../balance/morale";
import { DMath } from "../math/deterministic-math";
import { dangerOf, type TargetingWeights } from "./commander/commander-focus";
import { probeAccept, probeUnitRead } from "./faction-vision-probe";
import { fightingType, type MilitaryCombatant, militaryHealth } from "./military-combat-rules";
import { militaryContactReach } from "./military-contact";
import {
  acquireRadius, isOverClaimed, isRescoreTick, leashRadius, moraleAcquireRadius, moraleLeash, type MilitaryStance,
  SEEK_INTERVAL, SEEK_RADIUS, shouldSwitchTarget, STRIKE_BACK_SLACK, targetScore
} from "./military-targeting";
import { nationArcherRangeFactor } from "./nation-bonuses";
import { type CombatCore, type FieldMemory, type FieldTarget, profileOf } from "./settlement-combat-core";
import type { SettlementActor, SettlementPoint } from "./settlement-types";

/** A rider's charge lane (tiles): checked beyond a short dash, this wide, up to this far before the foe. */
const CHARGE_DASH = 3;
const CHARGE_LANE_WIDTH = .9;
const CHARGE_CLEAR_END = 2;

/** Whether `target` may be chased: the soldier itself stays within its leash. */
const withinLeash = (state: MilitaryCombatant, stance: MilitaryStance, memory: FieldMemory,
  target: SettlementPoint) => {
  const leash = moraleLeash(leashRadius(stance, fightingType(state)), memory.moraleState);
  if (!memory.anchor || leash === Infinity) return true;
  return DMath.hypot(target.x - memory.anchor.x, target.z - memory.anchor.z) <= leash + 1.5;
};

export const reachOf = (actor: SettlementActor, state: MilitaryCombatant, target: FieldTarget,
  nationRangeFactor = 1) => militaryContactReach(fightingType(state),
  profileOf(state).range * (fightingType(state) === "archer" ? nationRangeFactor : 1),
  actor, target.soldier.combat!.type, target.body);

/** A14-2 inputs of the target score: the per faction weights and the enemy commander hero's uid (per tick). */
export interface TargetingPriorities {
  heroUid: () => number | undefined;
  weightsOf: (faction: number) => Readonly<TargetingWeights>;
}

/**
 * Picking and keeping field targets. Re-scoring is staggered on the saved game tick, so a loaded battle
 * (or one after a quiet-island skip) re-scores on the same ticks as an uninterrupted one; `beginTick`
 * advances the fallback clock of bare fixtures without a game clock.
 */
export const createCombatTargeting = ({
  archery, context, factionOf, grid, inField, isKnownEnemyOf, knowledge, melee, sieges, soldiers
}: CombatCore, { heroUid, weightsOf }: TargetingPriorities) => {
  let fallbackTick = 0, hero: number | undefined, heroTick = -1;
  // The tick being simulated (the clock advances after it): equal to a per-update count from the island's start.
  const rescoreTick = () => context.clock ? context.clock.tick() + 1 : fallbackTick;
  /** The hero's uid, looked up once per tick (only when a soldier scores a target). */
  const heroOfTick = () => {
    const tick = rescoreTick();
    if (heroTick !== tick) { heroTick = tick; hero = heroUid(); }
    return hero;
  };
  const nationRange = (state: MilitaryCombatant) => state.faction === 0
    ? nationArcherRangeFactor(context.playerNation) : 1;
  /**
   * The live target `id` for this soldier: an enemy in the field (archers: also exposed posts,
   * excluding doorway defenders) that its faction knows now (A13 phase 3: seen or under a hit alert).
   */
  const targetOf = (id: number | undefined, state: MilitaryCombatant): FieldTarget | undefined => {
    if (id === undefined) return undefined;
    const soldier = soldiers.get(id);
    if (!soldier?.combat || soldier.combat.faction === state.faction) return undefined;
    const body = archery.targetBody(id);
    if (!body || !knowledge.troopKnows(state.faction, body)) return undefined;
    if (inField(body)) return { body, soldier };
    const shootable = archery.isExposed(id) ||
      (body.phase === "militarySiege" && body.visible && !sieges.isDefender(id));
    return fightingType(state) === "archer" && shootable ? { body, soldier } : undefined;
  };
  /**
   * A rider's way to a foe further than a short dash runs through its own comrades standing in the
   * field (sampled every tile, the last stretch at the foe left out: that is where the fight is).
   */
  const laneBlocked = (actor: SettlementActor, state: MilitaryCombatant, foe: SettlementActor, distance: number) => {
    if (!actor.mounted || distance <= CHARGE_DASH) return false;
    const comrade = (body: SettlementActor) => body !== actor && factionOf(body.uid) === state.faction && inField(body);
    for (let along = 1; along < distance - CHARGE_CLEAR_END; along++) {
      const share = along / distance;
      const x = actor.x + (foe.x - actor.x) * share, z = actor.z + (foe.z - actor.z) * share;
      if (grid.anyWithin(x, z, CHARGE_LANE_WIDTH, comrade)) return true;
    }
    return false;
  };
  const scoreOf = (actor: SettlementActor, state: MilitaryCombatant, target: FieldTarget, memory: FieldMemory) => {
    const distance = DMath.hypot(target.body.x - actor.x, target.body.z - actor.z);
    const own = state.target === target.body.uid && fightingType(state) !== "archer" ? 1 : 0;
    const combat = target.soldier.combat!, weights = weightsOf(state.faction);
    const focused = memory.focus === target.body.uid && distance <= FOCUS_RADIUS;
    return targetScore({ attackedMe: memory.lastAttacker === target.body.uid,
      claims: melee.claimCount(target.body.uid) - own,
      danger: dangerOf(fightingType(state), fightingType(combat), target.body.uid === heroOfTick()) * weights.danger,
      distance, focusBonus: focused ? weights.focus : 0,
      health: combat.hp / militaryHealth(combat.type, target.soldier.rank),
      inReach: distance >= profileOf(state).minimumRange
        && distance <= reachOf(actor, state, target, nationRange(state)),
      laneBlocked: laneBlocked(actor, state, target.body, distance),
      mounted: Boolean(target.body.mounted) }, fightingType(state) === "archer");
  };
  /**
   * A wavering or broken melee soldier (A14-2 morale) never joins a foe already at its claim cap unless that foe
   * struck it: it holds back, so the cap's score penalty cannot be outweighed by there being no other foe.
   */
  const joinsFullFight = (state: MilitaryCombatant, memory: FieldMemory, candidate: FieldTarget) =>
    (memory.moraleState ?? 0) >= MORALE_WAVERING && fightingType(state) !== "archer" &&
    memory.lastAttacker !== candidate.body.uid && state.target !== candidate.body.uid &&
    isOverClaimed(melee.claimCount(candidate.body.uid), Boolean(candidate.body.mounted));
  /** The best enemy within `radius`, by score (for camp guards: near their camp). */
  const bestTarget = (actor: SettlementActor, state: MilitaryCombatant, stance: MilitaryStance,
    memory: FieldMemory, radius: number) => {
    let best: FieldTarget | undefined, bestScore = Infinity;
    const consider = (id: number) => {
      const candidate = targetOf(id, state);
      if (!candidate || id === memory.ignored || !withinLeash(state, stance, memory, candidate.body)) return;
      if (joinsFullFight(state, memory, candidate)) return;
      const score = scoreOf(actor, state, candidate, memory);
      if (score < bestScore) { best = candidate; bestScore = score; }
    };
    grid.forEachWithin(actor.x, actor.z, radius, probeAccept("targeting.acquire", state.faction,
      isKnownEnemyOf(state.faction)), body => consider(body.uid));
    // A steady soldier also weighs its squad focus beyond the acquire radius (A14-2: the commander's order).
    const focus = memory.focus !== undefined && !memory.moraleState ? targetOf(memory.focus, state) : undefined;
    if (focus && DMath.hypot(focus.body.x - actor.x, focus.body.z - actor.z) <= FOCUS_RADIUS) {
      probeUnitRead("targeting.focus", state.faction, focus.body);
      consider(focus.body.uid);
    }
    if (fightingType(state) === "archer")
      archery.forEachExposed(actor, radius, state.faction, id => {
        // Only defenders at posts the archer's faction knows (A13 phase 3).
        const body = archery.targetBody(id);
        if (!body || !knowledge.troopKnows(state.faction, body)) return;
        probeUnitRead("targeting.exposedPost", state.faction, body);
        consider(id);
      });
    return best;
  };
  /**
   * Move orders only strike back at their attacker while it stands within reach (and a step), and while the
   * faction knows it (the hit alert makes an unseen attacker known for a while).
   */
  const strikeBackTarget = (actor: SettlementActor, state: MilitaryCombatant, memory: FieldMemory) => {
    const attacker = targetOf(memory.lastAttacker, state);
    if (!attacker) { memory.lastAttacker = undefined; return undefined; }
    probeUnitRead("targeting.strikeBack", state.faction, attacker.body);
    const distance = DMath.hypot(attacker.body.x - actor.x, attacker.body.z - actor.z);
    return distance <= reachOf(actor, state, attacker, nationRange(state)) + STRIKE_BACK_SLACK
      ? attacker : undefined;
  };
  /**
   * Target memory: the current target is kept while its faction knows it, re-scored every 0.4 s or at once
   * when struck. A target lost from sight (and not under a hit alert) is dropped.
   */
  const chooseTarget = (actor: SettlementActor, state: MilitaryCombatant, stance: MilitaryStance,
    memory: FieldMemory) => {
    const struck = memory.struck;
    memory.struck = false;
    if (stance === "move") return strikeBackTarget(actor, state, memory);
    const current = targetOf(state.target, state);
    if (current) probeUnitRead("targeting.keepTarget", state.faction, current.body);
    if (current && !withinLeash(state, stance, memory, current.body)) {
      memory.ignored = current.body.uid; return undefined;
    }
    if (current && !isRescoreTick(actor.uid, rescoreTick(), struck)) return current;
    const radius = moraleAcquireRadius(acquireRadius(stance, fightingType(state)), stance, fightingType(state),
      memory.moraleState);
    let best = bestTarget(actor, state, stance, memory, radius);
    if (!best && !current && stance === "seek" && !memory.moraleState && memory.seekTime <= 0) {
      memory.seekTime = SEEK_INTERVAL;
      best = bestTarget(actor, state, stance, memory, SEEK_RADIUS);
    }
    if (!current || !best || best === current) return current ?? best;
    const keep = !shouldSwitchTarget(scoreOf(actor, state, current, memory), scoreOf(actor, state, best, memory));
    return keep ? current : best;
  };
  const beginTick = () => { fallbackTick++; };
  return { beginTick, chooseTarget, rescoreTick, strikeBackTarget };
};
