import { MORALE_STEADY, MORALE_WAVERING } from "../../src/shared/balance/morale";
import {
  type MoraleTraceRecord, setMoraleTraceSink
} from "../../src/shared/settlement/commander/military-morale-trace";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";

/**
 * A14-2 morale log of a fixture (plan §10.2): rout count, time to rally and the break times inside and outside
 * a commander's aura, from the morale trace (read only; the state hash is unchanged).
 */
export interface MoraleMetrics {
  /** Computer soldiers' changes into wavering or broken (null: no morale trace, as on master). */
  routCount: number | null;
  /** Median seconds from a soldier's first loss of steadiness (shaken or worse) to its first return to steady. */
  timeToRallySeconds: number | null;
  /**
   * Median seconds to the first loss of steadiness of the soldiers of factions with an aura (inside) and without
   * (outside); a soldier that stayed steady counts the whole run. Null: no such soldiers.
   */
  breakSecondsInsideAura: number | null;
  breakSecondsOutsideAura: number | null;
  /**
   * Morale orders per minute (fall-back and rout commands; the runner adds the commander's morale-driven reserve
   * swaps), apart from the commander's churn.
   */
  moraleOrdersPerMinute: number | null;
}

const TICK_SECONDS = .05;

const median = (values: readonly number[]) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
const round = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;

export const createMoraleLog = (simulation: SettlementSimulation, computerFactions: readonly number[]) => {
  const records: MoraleTraceRecord[] = [];
  let startTick = 0;
  const soldiers = new Map<number, number>();
  const start = () => {
    // The morale trace stamps the tick being simulated (the clock advances after it).
    startTick = simulation.gameTick() + 1;
    for (const soldier of simulation.militarySoldiers())
      if (soldier.combat && soldier.commanderId === undefined) soldiers.set(soldier.actor, soldier.combat.faction);
    setMoraleTraceSink(record => { records.push({ ...record }); });
  };
  const stop = () => { setMoraleTraceSink(null); };
  const summary = (seconds: number): MoraleMetrics => {
    const breaks = new Map<number, number>(), rallies = new Map<number, number>(), auraFactions = new Set<number>();
    let routs = 0, ordered = 0;
    for (const record of records) {
      if (record.ordered > 0) ordered++;
      if (record.aura) auraFactions.add(record.faction);
      const routed = record.to >= MORALE_WAVERING && record.from < MORALE_WAVERING;
      if (routed && computerFactions.includes(record.faction)) routs++;
      if (record.from === MORALE_STEADY && !breaks.has(record.uid)) breaks.set(record.uid, record.tick);
      if (record.to === MORALE_STEADY && breaks.has(record.uid) && !rallies.has(record.uid))
        rallies.set(record.uid, record.tick);
    }
    const rally = [...rallies].map(([uid, tick]) => (tick - breaks.get(uid)!) * TICK_SECONDS);
    const inside: number[] = [], outside: number[] = [];
    for (const [uid, faction] of soldiers) {
      const tick = breaks.get(uid);
      const at = tick === undefined ? seconds : (tick - startTick) * TICK_SECONDS;
      (auraFactions.has(faction) ? inside : outside).push(at);
    }
    return {
      breakSecondsInsideAura: round(median(inside)), breakSecondsOutsideAura: round(median(outside)),
      moraleOrdersPerMinute: records.length ? round(ordered / (seconds / 60)) : null,
      routCount: records.length ? routs : null, timeToRallySeconds: round(median(rally))
    };
  };
  return { start, stop, summary };
};
