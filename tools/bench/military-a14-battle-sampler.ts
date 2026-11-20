import { MORALE_WAVERING } from "../../src/shared/balance/morale";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";

/**
 * A14 battle outcome sampler (plan §10.1/§10.2): casualties per side and type, the computer archers' position
 * behind their front, the computer archers' first target types and the player archers lost before the
 * player's foot line breaks. Read only; sampled after every tick.
 */
export interface BattleMetrics {
  /** Soldiers lost per faction and type: { "0": { archer: 2 } }. */
  casualties: Record<string, Partial<Record<MilitaryTroopType, number>>>;
  /**
   * Share of computer archer-seconds farther from the enemy centroid than their own melee front: its steady or
   * shaken foot (wavering and broken soldiers are no longer the front). Null: none.
   */
  archersBehindFrontShare: number | null;
  /** Troop types of the computer archers' first targets. */
  archerFirstTargets: Partial<Record<MilitaryTroopType, number>>;
  /** Player archers lost before the player's foot fell to half its strength (null: no such line). */
  playerArcherLossesBeforeLineBreak: number | null;
  /**
   * Player archer-seconds spent shooting (the bow's draw-and-loose time after each arrow) before the player's line
   * breaks (A14-2 flank
   * gate: a foot flank that cannot catch kiting archers must at least keep them from shooting).
   */
  playerArcherFiringSeconds: number;
  /** Seconds until the player's foot line fell to half (null: it held). */
  lineBreakSeconds: number | null;
}

interface Roster { faction: number; type: MilitaryTroopType }
/** `wavering`: wavering or broken (A14-2 morale): falling back or routing, no longer the front. */
interface Placed {
  faction: number; shooting: boolean; type: MilitaryTroopType; target?: number; wavering: boolean; x: number;
  z: number;
}

const FOOT: readonly MilitaryTroopType[] = ["shield", "heavy"];
const LINE_BREAK_SHARE = .5;
const PLAYER = 0;

const centroid = (points: readonly SettlementPoint[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  z: points.reduce((sum, point) => sum + point.z, 0) / points.length
});
const distance = (a: SettlementPoint, b: SettlementPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const increment = <Key extends string>(record: Partial<Record<Key, number>>, key: Key) => {
  record[key] = (record[key] ?? 0) + 1;
};

export const createBattleSampler = (simulation: SettlementSimulation, computerFactions: readonly number[]) => {
  const roster = new Map<number, Roster>();
  const firstTargets: Partial<Record<MilitaryTroopType, number>> = {};
  const targeted = new Set<number>();
  let behind = 0, archerSamples = 0, time = 0, firing = 0;
  let lineBreak: { archers: number; seconds: number } | null = null;

  /** The field soldiers alive now, by uid. */
  const placed = () => {
    const bodies = new Map(simulation.frames().map(actor => [actor.uid, actor]));
    const alive = new Map<number, Placed>();
    // Older commits report no morale: everyone counts as steady.
    const morale = (simulation.militaryAiDebug() as { morale?: [number, number][] }).morale ?? [];
    const wavering = new Set(morale.filter(([, state]) => state >= MORALE_WAVERING).map(([uid]) => uid));
    for (const soldier of simulation.militarySoldiers()) {
      const combat = soldier.combat, body = bodies.get(soldier.actor);
      if (!combat || combat.hp <= 0 || !body) continue;
      if (!roster.has(soldier.actor)) roster.set(soldier.actor, { faction: combat.faction, type: combat.type });
      if (body.visible && body.phase === "militaryField")
        alive.set(soldier.actor, { faction: combat.faction, shooting: (combat.attackTime ?? 0) > 0,
          target: combat.target, type: combat.type,
          wavering: wavering.has(soldier.actor), x: body.x, z: body.z });
    }
    return alive;
  };

  const sampleArchersBehind = (alive: ReadonlyMap<number, Placed>, faction: number) => {
    const own = [...alive.values()].filter(unit => unit.faction === faction);
    const enemies = [...alive.values()].filter(unit => unit.faction !== faction);
    const front = own.filter(unit => FOOT.includes(unit.type) && !unit.wavering);
    if (!enemies.length || !front.length) return;
    const enemy = centroid(enemies), frontDistance = distance(centroid(front), enemy);
    for (const archer of own) if (archer.type === "archer") {
      archerSamples++;
      if (distance(archer, enemy) > frontDistance) behind++;
    }
  };

  const sampleFirstTargets = (alive: ReadonlyMap<number, Placed>) => {
    for (const [uid, unit] of alive) {
      if (unit.type !== "archer" || unit.target === undefined || targeted.has(uid)) continue;
      if (!computerFactions.includes(unit.faction)) continue;
      targeted.add(uid);
      const target = roster.get(unit.target);
      if (target) increment(firstTargets, target.type);
    }
  };

  const lost = (faction: number, types: readonly MilitaryTroopType[], alive: ReadonlyMap<number, Placed>) => {
    let count = 0;
    for (const [uid, entry] of roster)
      if (entry.faction === faction && types.includes(entry.type) && !alive.has(uid)) count++;
    return count;
  };

  const sampleLineBreak = (alive: ReadonlyMap<number, Placed>) => {
    if (lineBreak) return;
    const foot = [...roster.values()].filter(entry => entry.faction === PLAYER && FOOT.includes(entry.type)).length;
    if (!foot || lost(PLAYER, FOOT, alive) < foot * LINE_BREAK_SHARE) return;
    lineBreak = { archers: lost(PLAYER, ["archer"], alive), seconds: time };
  };

  const sample = (dt: number) => {
    time += dt;
    const alive = placed();
    for (const faction of computerFactions) sampleArchersBehind(alive, faction);
    sampleFirstTargets(alive);
    sampleLineBreak(alive);
    if (lineBreak) return;
    for (const unit of alive.values())
      if (unit.faction === PLAYER && unit.type === "archer" && unit.shooting) firing += dt;
  };

  const casualties = (alive: ReadonlyMap<number, Placed>) => {
    const result: BattleMetrics["casualties"] = {};
    for (const [uid, entry] of [...roster].sort(([a], [b]) => a - b)) {
      if (alive.has(uid)) continue;
      increment(result[String(entry.faction)] ??= {}, entry.type);
    }
    return result;
  };

  /** Soldiers still standing but outside the field (garrisoned, stored) are alive too. */
  const standing = () => {
    const alive = placed();
    for (const soldier of simulation.militarySoldiers()) {
      const combat = soldier.combat;
      if (combat && combat.hp > 0 && !alive.has(soldier.actor))
        alive.set(soldier.actor, { faction: combat.faction, shooting: false, type: combat.type, wavering: false, x: 0,
          z: 0 });
    }
    return alive;
  };

  const summary = (): BattleMetrics => {
    const alive = standing();
    const fielded = (types: readonly MilitaryTroopType[]) =>
      [...roster.values()].some(entry => entry.faction === PLAYER && types.includes(entry.type));
    const lineMeasured = fielded(["archer"]) && fielded(FOOT);
    const archersLost = lineBreak?.archers ?? lost(PLAYER, ["archer"], alive);
    return {
      archerFirstTargets: { ...firstTargets },
      archersBehindFrontShare: archerSamples ? Math.round(behind / archerSamples * 1000) / 1000 : null,
      casualties: casualties(alive),
      lineBreakSeconds: lineBreak ? Math.round(lineBreak.seconds * 10) / 10 : null,
      playerArcherFiringSeconds: Math.round(firing * 10) / 10,
      playerArcherLossesBeforeLineBreak: lineMeasured ? archersLost : null
    };
  };
  return { sample, summary };
};
