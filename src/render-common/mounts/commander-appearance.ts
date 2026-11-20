import { COMMANDER_AURA_RADIUS } from "../../shared/settlement/settlement-commander";
import type { WorkerNation } from "../workers/worker-unit";

/**
 * Visual presentation of the player's national commander on the existing mounted rig. The
 * commander keeps the nation's riding body and armour pipeline, but wears the "centurion" armour
 * set and a national command standard; ordinary soldiers and veterans keep their own helmets.
 * Aura colours and the six-tile radius come from the canonical commander definition.
 */
export type CommanderArmourRank = "centurion";
export type CommanderInsigniaKind = "bow" | "sashimono" | "shield" | "standard";

export interface CommanderAppearance {
  armourRank: CommanderArmourRank;
  /** Soft ground-effect tint of the six-tile aura. */
  auraColor: number;
  /** Cloth of the back standard and saddle pennant. */
  bannerColor: number;
  /** Metallic trim and emblem tint. */
  emblemColor: number;
  insignia: CommanderInsigniaKind;
  /** Every commander shows the same canonical six-tile radius (world tiles). */
  auraRadius: number;
}

const APPEARANCES: Readonly<Record<WorkerNation, CommanderAppearance>> = Object.freeze({
  maya: { armourRank: "centurion", auraColor: 0x78a7d8, bannerColor: 0x8c1c17, emblemColor: 0xe0b552,
    insignia: "shield", auraRadius: COMMANDER_AURA_RADIUS },
  persian: { armourRank: "centurion", auraColor: 0x78a7d8, bannerColor: 0x8c1c17, emblemColor: 0xe0b552,
    insignia: "shield", auraRadius: COMMANDER_AURA_RADIUS },
  chinese: { armourRank: "centurion", auraColor: 0x78a7d8, bannerColor: 0x8c1c17, emblemColor: 0xe0b552,
    insignia: "shield", auraRadius: COMMANDER_AURA_RADIUS },
  indigenous: { armourRank: "centurion", auraColor: 0x78a7d8, bannerColor: 0x8c1c17, emblemColor: 0xe0b552,
    insignia: "shield", auraRadius: COMMANDER_AURA_RADIUS },
  japanese: { armourRank: "centurion", auraColor: 0x9fd8a6, bannerColor: 0x232a4a, emblemColor: 0xe8dfc8,
    insignia: "sashimono", auraRadius: COMMANDER_AURA_RADIUS },
  nubian: { armourRank: "centurion", auraColor: 0xe3b34b, bannerColor: 0xa86c19, emblemColor: 0x23756f,
    insignia: "bow", auraRadius: COMMANDER_AURA_RADIUS },
  roman: { armourRank: "centurion", auraColor: 0x78a7d8, bannerColor: 0x8c1c17, emblemColor: 0xe0b552,
    insignia: "shield", auraRadius: COMMANDER_AURA_RADIUS },
  viking: { armourRank: "centurion", auraColor: 0xd6614c, bannerColor: 0x7a1512, emblemColor: 0xd8b573,
    insignia: "standard", auraRadius: COMMANDER_AURA_RADIUS }
});

export const commanderAppearance = (nation: WorkerNation): CommanderAppearance => APPEARANCES[nation];

/** Ordinary riders keep their existing "soldier" armour; only the commander wears centurion pieces. */
export const riderArmourRank = (commander: boolean): "centurion" | "soldier" =>
  commander ? "centurion" : "soldier";

export const COMMANDER_AURA_RADIUS_TILES = COMMANDER_AURA_RADIUS;
