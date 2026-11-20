import { MONUMENT_DEFENDER_RANK, MONUMENT_START_DEFENDERS } from "@shared/catalog/balance";

import { hasMonumentBonus } from "../progression/monument-bonus";
import { createRandom } from "../world/rng";
import {
  CAMPAIGN_GARRISON_SEED_DIGITS, HEX_RADIX, MONUMENT_DEFENDER_TYPES, MONUMENT_GARRISON_SEED_MIX
} from "./constants";
import { militaryHealth } from "./military-combat-rules";
import type { EmigratedTroop } from "./settlement-military";
import { hashText } from "./settlement-state-hash";

export interface MonumentStartGarrisonInput {
  /** A completed home Monument (`hasMonumentBonus(progress)`); false gives no defenders. */
  active: boolean;
  /** The new start's stable identity: the colony island seed and expedition id, or campaign map/attempt. */
  key: number;
  seed: number;
}

/**
 * The Monument's harbour defenders of a NEW colony or campaign start: three full-health tier-3 melee
 * soldiers, each type a deterministic seeded choice. Adventure islands never call this. Pure: the caller
 * records the result in its start command (`startColony` setup `defenders`), so replays need no rerun.
 */
export const monumentStartGarrison = ({ active, key, seed }: MonumentStartGarrisonInput): EmigratedTroop[] => {
  if (!active) return [];
  const random = createRandom((seed ^ Math.imul(key + 1, MONUMENT_GARRISON_SEED_MIX)) >>> 0);
  return Array.from({ length: MONUMENT_START_DEFENDERS }, () => {
    const type = MONUMENT_DEFENDER_TYPES[Math.floor(random() * MONUMENT_DEFENDER_TYPES.length)]!;
    return { hp: militaryHealth(type, MONUMENT_DEFENDER_RANK), rank: MONUMENT_DEFENDER_RANK, type };
  });
};

/** A recorded start's defenders: none, or exactly the Monument's three full-health tier-3 melee soldiers. */
export const isMonumentStartGarrison = (troops: readonly EmigratedTroop[] | undefined) => {
  if (!troops?.length) return true;
  return troops.length === MONUMENT_START_DEFENDERS && troops.every(troop =>
    (MONUMENT_DEFENDER_TYPES as readonly string[]).includes(troop.type) && troop.rank === MONUMENT_DEFENDER_RANK &&
    troop.hp === militaryHealth(troop.type, MONUMENT_DEFENDER_RANK) && troop.commander === undefined);
};

/** The identity fields of a campaign attempt (`CampaignRunState` / `CampaignMarker`). */
export interface CampaignGarrisonStart { attempt: number; campaignId: string; mapId: string }

/**
 * Campaign start hook (C8 departure / C9 runtime start): the Monument's harbour defenders of a NEW campaign
 * attempt, stationed at the landing harbour. They are not cargo and do not count against the map's player
 * soldier cap. Seeded by campaign/map id and attempt, so a restart may draw other types.
 */
export const campaignMonumentGarrison = (
  progress: { homeMonument?: true } | undefined, start: CampaignGarrisonStart
) => monumentStartGarrison({ active: hasMonumentBonus(progress), key: start.attempt,
  seed: parseInt(hashText(`${start.campaignId}/${start.mapId}`).slice(0, CAMPAIGN_GARRISON_SEED_DIGITS), HEX_RADIX) });
