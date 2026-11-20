import {
  DEFAULT_ONLINE_SETTINGS, type GameSettings
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { localRulesRevision, type SimRules } from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { localSessionRules } from "../../shared/settlement/sim-rules";

const DEFAULT_LOCAL_REVISION = localRulesRevision(DEFAULT_ONLINE_SETTINGS);

/**
 * The session rules of a game without a lease (plan §7.1, rev I6): browser-only online play (guest, standalone,
 * unreachable server) and offline mode. The deployment's settings pin as `local:<hash>` only when their simulated
 * subset differs from today's game; equal or unknown settings and every tool run keep `LEGACY_SIM_RULES` (nothing
 * adopted, no hash change), so today's default deployment stays byte-identical.
 */
export const browserSessionRules = (settings: GameSettings | null, toolRun: boolean): SimRules | undefined => {
  if (toolRun || !settings) return undefined;
  if (localRulesRevision(settings) === DEFAULT_LOCAL_REVISION) return undefined;
  return localSessionRules(settings);
};
