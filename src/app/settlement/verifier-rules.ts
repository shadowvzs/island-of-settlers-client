import { isSimRules } from "../../../../island-of-settlers-shared/src/game-settings/game-settings-shape";
import type { SimRules } from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import type { CommandLogInterval } from "../../shared/settlement/command-log";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { rulesRevisionOf } from "../../shared/settlement/sim-rules";

/**
 * The server's copies of the game rules a verified chain runs under (GS2, plan §12.1): the API resolves every
 * revision the chain names (the base island's pinned revision and each `adoptGameRules`) from its own revision
 * table and passes them keyed by revision. The client's copies in the snapshot and the command are never used;
 * a revision the server did not issue voids the chain.
 */
export type ServerRulesByRevision = Readonly<Record<string, SimRules>>;

export const UNKNOWN_RULES_REVISION = "The game rules revision was not issued by this server";

type LogEntry = CommandLogInterval["entries"][number];

const ADOPT_GAME_RULES = "adoptGameRules";

const loggedRevision = (entry: LogEntry) => {
  const rules = entry.command.args[0];
  return isSimRules(rules) ? rules.revision : undefined;
};

/** The server's rules of `revision`, or undefined when it never issued it. */
const serverRules = (rules: ServerRulesByRevision, revision: string | undefined) =>
  revision !== undefined && Object.hasOwn(rules, revision) ? rules[revision] : undefined;

/**
 * The base game with the server's copy of its island's pinned rules, or a refusal. A legacy island (no pin)
 * stays as it is: legacy means today's built-in rules, never a stored document.
 */
export const withServerBaseRules = (base: GameSaveV1, rules: ServerRulesByRevision): GameSaveV1 | string => {
  const pinned = base.settlement.gameRules;
  if (!pinned) return base;
  const resolved = serverRules(rules, rulesRevisionOf(pinned));
  if (!resolved) return UNKNOWN_RULES_REVISION;
  return { ...base, settlement: { ...base.settlement, gameRules: structuredClone(resolved) } };
};

/** Refusal of a logged `adoptGameRules` whose revision the server did not issue; undefined otherwise. */
export const adoptRevisionProblem = (entry: LogEntry, rules: ServerRulesByRevision) => {
  if (entry.command.name !== ADOPT_GAME_RULES) return undefined;
  return serverRules(rules, loggedRevision(entry)) ? undefined : UNKNOWN_RULES_REVISION;
};

/** The arguments a logged command replays with: the server's rules document for `adoptGameRules`. */
export const serverCommandArgs = (entry: LogEntry, rules: ServerRulesByRevision): readonly unknown[] => {
  if (entry.command.name !== ADOPT_GAME_RULES) return entry.command.args;
  const resolved = serverRules(rules, loggedRevision(entry));
  return resolved ? [structuredClone(resolved)] : entry.command.args;
};
