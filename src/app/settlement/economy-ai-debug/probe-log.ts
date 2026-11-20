import type { DevelopGoalReport } from "../../../shared/settlement/economy-ai/develop-diagnostics";
import type {
  FactionAiDecisionRecorder, FactionAiMaintainKind
} from "../../../shared/settlement/economy-ai/faction-ai-probe";

/** Something the probe heard, with the game tick it happened on. */
export interface EconomyAiLogEntry {
  detail: string;
  tick: number;
}

/** What the probe heard of one faction since the window was opened (never saved, never read by a decision). */
export interface EconomyAiFactionLog {
  /** The last planner refusal per goal building type. */
  goalRefusals: Map<number, EconomyAiLogEntry>;
  /** The last `maintain` action or refusal per kind. */
  maintain: Partial<Record<FactionAiMaintainKind, EconomyAiLogEntry>>;
  /** Why the real rules refused a plot, by `plotKey`. */
  plotReasons: Map<string, string>;
  /** The last strategic decision's scored goals. */
  report?: DevelopGoalReport;
  reportTick?: number;
}

export const plotKey = (typeId: number, entry: number) => `${typeId}/${entry}`;

const createFactionLog = (): EconomyAiFactionLog => ({ goalRefusals: new Map(), maintain: {}, plotReasons: new Map() });

/**
 * The "why" window's probe recorder: it keeps only the latest answer per question, so its memory is bounded by the
 * goals and the memo's plots. `prunePlots` forgets the reasons of plots the memo no longer holds.
 */
export const createEconomyAiProbeLog = () => {
  const logs = new Map<number, EconomyAiFactionLog>();
  const logOf = (faction: number) => {
    const existing = logs.get(faction);
    if (existing) return existing;
    const created = createFactionLog();
    logs.set(faction, created);
    return created;
  };
  const recorder: FactionAiDecisionRecorder = {
    decide: () => undefined,
    goalRefused: (faction, tick, typeId, reason) => {
      logOf(faction).goalRefusals.set(typeId, { detail: reason, tick });
    },
    goals: (faction, tick, report) => {
      const log = logOf(faction);
      log.report = report;
      log.reportTick = tick;
    },
    maintain: (faction, tick, kind, detail) => { logOf(faction).maintain[kind] = { detail, tick }; },
    plotRefused: (faction, _tick, typeId, entry, reason) => {
      logOf(faction).plotReasons.set(plotKey(typeId, entry), reason);
    }
  };
  return {
    clear: () => logs.clear(),
    of: (faction: number): EconomyAiFactionLog | undefined => logs.get(faction),
    /** Keeps only the reasons of the plots the faction's memo still holds. */
    prunePlots: (faction: number, held: ReadonlySet<string>) => {
      const reasons = logs.get(faction)?.plotReasons;
      if (!reasons) return;
      for (const key of reasons.keys()) if (!held.has(key)) reasons.delete(key);
    },
    recorder
  };
};

export type EconomyAiProbeLog = ReturnType<typeof createEconomyAiProbeLog>;
