import type {
  FactionAiLevel, FactionAiMode, FactionAiStyle, ScenarioFactionAi
} from "../../world/scenario-faction-ai";
import type { FACTION_AI_LAYERS } from "./constants";
import type { DevelopSave, DevelopState } from "./develop-state";
import type { FactionGoal } from "./faction-goal";
import type { FactionStrategySave, FactionStrategyState } from "./faction-strategy-state";
import type { MaintainSave, MaintainState } from "./maintain-state";
import type { PlannerSave, PlannerState } from "./planner-state";

export type FactionAiLayer = (typeof FACTION_AI_LAYERS)[number];

/** What a faction knows of enemy soldiers at its last strategic decision (A13 knowledge only). */
export interface FactionAiThreat {
  /** Summed health of the known enemy soldiers. */
  health: number;
  soldiers: number;
}

/**
 * Derived values for the dev overlay and probes: never saved. Decisions read only `threat`, and only within the
 * strategic decision that has just recomputed it, so a reload (which starts them again from zero) cannot change
 * what the AI does.
 */
export interface FactionAiDiagnostics {
  /** Decisions taken per layer since the island was created or loaded, in `FACTION_AI_LAYERS` order. */
  readonly decisions: number[];
  readonly threat: FactionAiThreat;
}

/** One computer faction's live AI (plan §2.4): its map entry, what scripts changed and its decision clocks. */
export interface FactionAiState {
  /** The map's entry (start, bonus, limits, expand): pinned with the map file, so it is never saved. */
  readonly authored: Readonly<ScenarioFactionAi>;
  /** The `develop` goal memory: the committed build goal and the refused goals' backoffs (EAI3a). */
  readonly develop: DevelopState;
  readonly diagnostics: FactionAiDiagnostics;
  /**
   * Whether the faction runs an economy (pools, workers, logistics): from the start when the map gives it an AI,
   * from its first switch to `maintain`/`develop` when a script wakes it (EAI2b); kept when a script stops it.
   */
  economy: boolean;
  /** The next due game tick of each layer, in `FACTION_AI_LAYERS` order (absolute ticks, saved). */
  readonly due: number[];
  readonly faction: number;
  /** The strategic goal a script set (`setFactionGoal`, EAI4c) until its tick; absent: the faction's own posture. */
  goal?: FactionGoal;
  /** The level a script set (`setFactionAi`); absent: the map's level, then the island's and the difficulty. */
  level?: FactionAiLevel;
  /** The `maintain` memory: plots waiting to be rebuilt (EAI2b), walls whose repair waits (EAI2d). */
  readonly maintain: MaintainState;
  /** The mode the faction plays now: the map's, or the one a script switched to. */
  mode: FactionAiMode;
  /** A script paused the faction's decisions (`factionAiPause`); its clocks keep their slots. */
  paused: boolean;
  /** The `develop` build planner: the current goal, the refused goal's backoff, the failed-plot memo (EAI3b). */
  readonly planner: PlannerState;
  /** The faction's own strategic intents: its offensive's target, back-off and whether intents stand (EAI4b). */
  readonly strategy: FactionStrategyState;
  /** The style a script set; it leaves with the develop mode. Absent: the map's style, then balanced. */
  style?: FactionAiStyle;
}

/** A faction's AI as it plays now: the map entry with what scripts changed (EAI2c `factionAiSetting`). */
export interface FactionAiSetting {
  level?: FactionAiLevel;
  mode: FactionAiMode;
  paused: boolean;
  style?: FactionAiStyle;
}

/**
 * One faction in `SettlementSaveV1.factionAi` (settlement format 17; `economy`, `maintain` 18; `maintain.repairs`
 * 19; `develop` 20; `goal` 21; `strategy` 24; `planner` is additive: absent unless a `develop` faction remembers a
 * refused plot), ascending.
 */
export interface FactionAiSave {
  /** Absent while the faction holds no goal and no backoff. */
  develop?: DevelopSave;
  due: number[];
  /** A script woke the map's `none` faction: it runs an economy (absent for the map's AI factions). */
  economy?: true;
  faction: number;
  /** Absent while no script goal runs. */
  goal?: FactionGoal;
  level?: FactionAiLevel;
  /** Absent while nothing waits to be rebuilt. */
  maintain?: MaintainSave;
  mode: FactionAiMode;
  paused?: true;
  /** Absent while the build planner remembers no backoff and no failed plot. */
  planner?: PlannerSave;
  /** Absent while the faction's own strategic intents have nothing to remember. */
  strategy?: FactionStrategySave;
  style?: FactionAiStyle;
}

/** A plain copy of one faction's state for the dev overlay (`factionAiDiagnostics`). */
export interface FactionAiSnapshot extends FactionAiSave {
  decisions: number[];
  threat: FactionAiThreat;
}
