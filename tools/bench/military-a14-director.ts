import {
  type DirectorTraceRecord, setDirectorTraceSink
} from "../../src/shared/settlement/commander/director-trace";

/**
 * A14-4a director metrics for the fixtures (plan §10.1 fog raid, 4-faction stagger): every director decision
 * from the trace sink (reads no simulation state), the most director decisions in one tick (staggered: 1), each
 * force's macro sequence, and whether a strike or raid was chosen while the faction knew no site.
 */
export interface DirectorMetrics {
  directorDecisions: number;
  /** Most director decisions (of any faction) in a single tick. */
  maxDirectorDecisionsPerTick: number;
  /** Per `faction:force`, its macros in decision order with repeats collapsed ("hold>scout>strike"). */
  directorMacros: Record<string, string>;
  /** Seconds from the start to each force's first strike or raid (null: none). */
  firstStrikeSeconds: number | null;
  /** Strike or raid decisions taken while the faction knew no target and the force had no wave goal. */
  strikesWithoutKnownSite: number;
}

const TICKS_PER_SECOND = 20;
const OFFENSIVE = new Set(["strike", "raid"]);

export const createDirectorLog = () => {
  const records: DirectorTraceRecord[] = [];
  let firstTick: number | undefined;
  const record = (entry: DirectorTraceRecord) => { records.push({ ...entry }); };
  const summary = (): DirectorMetrics => {
    const perTick = new Map<number, number>(), macros = new Map<string, string[]>();
    let firstStrike: number | undefined, blind = 0;
    for (const entry of records) {
      perTick.set(entry.tick, (perTick.get(entry.tick) ?? 0) + 1);
      const key = `${entry.faction}:${entry.force}`, list = macros.get(key) ?? [];
      if (list.at(-1) !== entry.macro) list.push(entry.macro);
      macros.set(key, list);
      if (!OFFENSIVE.has(entry.macro) || entry.kind === "wave") continue;
      if (!entry.knownTargets) blind++;
      firstStrike ??= entry.tick;
    }
    return {
      directorDecisions: records.length,
      directorMacros: Object.fromEntries([...macros].map(([key, list]) => [key, list.join(">")])),
      firstStrikeSeconds: firstStrike === undefined || firstTick === undefined ? null
        : Math.round((firstStrike - firstTick) / TICKS_PER_SECOND * 10) / 10,
      maxDirectorDecisionsPerTick: Math.max(0, ...perTick.values()),
      strikesWithoutKnownSite: blind
    };
  };
  return {
    start: (tick: number) => {
      firstTick = tick;
      setDirectorTraceSink(record);
    },
    stop: () => { setDirectorTraceSink(null); },
    summary
  };
};
