import { RAID_PARTY_MAX } from "../../balance/commander-director";
import { REFERENCE_SOLDIER } from "../commander/known-sites";
import type { StrategicIntent } from "../commander/strategic-intents";
import type { SettlementContext } from "../settlement-types";
import { RESERVE_RELEASE_MAX } from "./constants";

/**
 * The faction's offensive soldiers from its depot (EAI4-FOLLOWUP): a `develop` faction keeps its spare soldiers
 * stored, and the director forms forces only from field soldiers, so the strategy counts the spare reserve as
 * strength it can call up and releases what its attack, raid or scout still lacks. The garrison minimum stays
 * stored (the kernel's `spareReserve`).
 */

/** Strength points of the faction's spare stored soldiers (each counted as one reference soldier). */
export const reserveStrength = (context: Pick<SettlementContext, "military">, faction: number) =>
  (context.military?.spareReserve?.(faction) ?? 0) * REFERENCE_SOLDIER;

/** The soldiers a raid calls up: the level's raid party, else the director's party maximum. */
const raidPartyOf = (raidParty: number) => raidParty > 0 ? raidParty : RAID_PARTY_MAX;

/** The strength an intent's force wants in all (0: it needs no field soldiers). */
const strengthGoal = (intent: StrategicIntent, raidParty: number) => {
  if (intent.kind === "attack") return intent.minStrength;
  if (intent.kind === "raid") return raidPartyOf(raidParty) * REFERENCE_SOLDIER;
  return intent.kind === "scout" ? REFERENCE_SOLDIER : 0;
};

/**
 * Releases the stored soldiers the faction's stated intents still lack beyond `available` (its free field strength
 * plus what its running offensive has committed), at most `RESERVE_RELEASE_MAX`; a raid wants the level's
 * `raidParty` (0: the director's party maximum). Returns the soldiers released.
 */
export const musterReserve = (
  context: Pick<SettlementContext, "military">, faction: number, intents: readonly StrategicIntent[],
  available: number, raidParty = 0
) => {
  const release = context.military?.releaseReserve;
  if (!release) return 0;
  let goal = 0;
  for (const intent of intents) goal = Math.max(goal, strengthGoal(intent, raidParty));
  const missing = goal - available;
  if (missing <= 0) return 0;
  return release(faction, Math.min(RESERVE_RELEASE_MAX, Math.ceil(missing / REFERENCE_SOLDIER)));
};
