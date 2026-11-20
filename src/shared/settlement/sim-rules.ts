import { LEGACY_RULES_REVISION } from "../../../../island-of-settlers-shared/src/game-settings/constants";
import {
  type EffectiveRules, effectiveRules, resolveEffectiveLevel
} from "../../../../island-of-settlers-shared/src/game-settings/effective-rules";
import { isSimRules } from "../../../../island-of-settlers-shared/src/game-settings/game-settings-shape";
import type { MapRules } from "../../../../island-of-settlers-shared/src/game-settings/map-rules";
import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  LEGACY_SIM_RULES, localRulesRevision, type SimRules, toSimRules
} from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { contextIslandRole, type IslandRole } from "./island-role";
import type { SettlementContext } from "./settlement-types";

/**
 * The game rules of one island simulation (plan §6, §12.1, lane GS2). The island save pins a copy of the game's
 * `SimRules` (`SettlementSaveV1.gameRules`, saved and hashed only when present); a save without one plays today's
 * game (`LEGACY_SIM_RULES`). The pinned copy changes only through the recorded `adoptGameRules` command, so every
 * replay (headless, verifier, catch-up) sees the same rules at the same tick. Every simulation reader goes through
 * `rulesOf(context)`; map rules are read only through GS0's `effectiveRules`.
 */
export type { EffectiveRules, SimRules };

/** Refusal of `adoptGameRules` with a payload that is not a complete `SimRules` document. */
export const INVALID_GAME_RULES = "Invalid game rules";

interface RulesCache {
  map: MapRules | undefined;
  pinned: SimRules | undefined;
  role: IslandRole;
  rules: EffectiveRules;
}

const rulesCaches = new WeakMap<SettlementContext, RulesCache>();

/** The revision a save or island runs under: its pinned revision, `legacy` without one. */
export const rulesRevisionOf = (rules: Pick<SimRules, "revision"> | undefined) =>
  rules?.revision ?? LEGACY_RULES_REVISION;

/** The pinned game rules of the island; undefined = legacy (today's game). */
export const contextGameRules = (context: SettlementContext): SimRules | undefined => context.gameRules;

/**
 * The one simulation accessor: the island's effective rules (pinned game rules narrowed by its map and role).
 * Cached per island; a new pinned copy (`adoptGameRules`, a load) or another role recomputes it.
 */
export const rulesOf = (context: SettlementContext): EffectiveRules => {
  const pinned = context.gameRules, role = contextIslandRole(context);
  // The map file's narrowing rules (GS-MAP, validated with the scenario): read only through `effectiveRules`.
  const map = context.options.world.scenario?.rules;
  const cached = rulesCaches.get(context);
  if (cached && cached.pinned === pinned && cached.role === role && cached.map === map) return cached.rules;
  const rules = effectiveRules(pinned ?? LEGACY_SIM_RULES, map, role);
  rulesCaches.set(context, { map, pinned, role, rules });
  return rules;
};

/**
 * The level the island plays with. Earned levels return the account level (`options.playerLevel`) untouched, and
 * undefined when the island has no account level, exactly as today's readers saw it; each caller keeps its own
 * fallback. A fixed or capped level (settings or map) answers even without an account level.
 */
export const contextPlayerLevel = (context: SettlementContext): number | undefined => {
  const rule = rulesOf(context).level, accountLevel = context.options.playerLevel?.();
  if (rule.kind === "earned") return accountLevel;
  return resolveEffectiveLevel(rule, accountLevel ?? rule.level);
};

/** A detached copy of valid rules; undefined for anything else. */
const copiedRules = (value: unknown): SimRules | undefined =>
  isSimRules(value) ? structuredClone(value) : undefined;

/** Save field of the pinned rules (absent = legacy, so a legacy save hashes unchanged). */
export const saveGameRules = (context: SettlementContext): { gameRules?: SimRules } =>
  context.gameRules ? { gameRules: structuredClone(context.gameRules) } : {};

/** A load replaces the pinned rules with the save's: the save decides, not the session that loads it. */
export const restoreGameRules = (context: SettlementContext, saved: unknown) => {
  context.gameRules = copiedRules(saved);
};

/** Why a save's pinned rules are invalid; null when absent or valid. */
export const gameRulesProblem = (value: unknown) =>
  value === undefined || isSimRules(value) ? null : INVALID_GAME_RULES;

/**
 * The recorded `adoptGameRules` command: the island now runs under `rules` (the full document, rev G15, so offline
 * and local replays need no server; the server verifier substitutes its own copy of the revision). The legacy
 * revision clears the pinned copy, so a save returned to today's rules hashes like one that never pinned any.
 */
export const adoptContextGameRules = (context: SettlementContext, rules: unknown): true | string => {
  const adopted = copiedRules(rules);
  if (!adopted) return INVALID_GAME_RULES;
  context.gameRules = adopted.revision === LEGACY_RULES_REVISION ? undefined : adopted;
  return true;
};

/**
 * The session rules of a standalone build (plan §12.1): the local settings under their `local:<hash>` revision,
 * so changing the local settings re-pins through the same `adoptGameRules`. Without a local settings document the
 * build keeps today's rules (rev G17): undefined, nothing is adopted.
 */
export const localSessionRules = (settings: GameSettings | undefined): SimRules | undefined =>
  settings && toSimRules(settings, localRulesRevision(settings));

/** True when an island pinned to `pinned` must adopt `session` (another revision). */
export const needsRulesAdoption = (pinned: SimRules | undefined, session: SimRules | undefined) =>
  session !== undefined && rulesRevisionOf(pinned) !== session.revision;

/**
 * At an island's first live tick (after its command log is bound, so the change is recorded): adopt the session's
 * rules when the island pinned another revision. Without session rules (guest, offline, older server) nothing
 * changes. Returns whether the island adopted.
 */
export const adoptSessionRules = (
  simulation: { adoptGameRules: (rules: SimRules) => true | string; gameRules: () => SimRules | undefined },
  session: SimRules | undefined
) => {
  if (!needsRulesAdoption(simulation.gameRules(), session)) return false;
  const adopted = simulation.adoptGameRules(session!);
  if (adopted !== true) throw new Error(adopted);
  return true;
};

/** The simulation facade's rule methods: two queries and the recorded command. */
export const createSimulationGameRules = (context: SettlementContext) => ({
  /** The pinned game rules (a copy); undefined = legacy. */
  gameRules: (): SimRules | undefined => context.gameRules && structuredClone(context.gameRules),
  /** The island's effective rules (game rules narrowed by its map and role); shared, read-only. */
  effectiveGameRules: (): Readonly<EffectiveRules> => rulesOf(context),
  /** Recorded (ledger): the island adopts the session's game rules at its first live tick (plan §12.1). */
  adoptGameRules: (rules: unknown): true | string => adoptContextGameRules(context, rules)
});
