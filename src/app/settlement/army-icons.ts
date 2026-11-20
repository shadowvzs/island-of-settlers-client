import { commanderEntry, soldierEntry } from "@shared/catalog";

import { MILITARY_TROOP_TYPES, type MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import { resolveAssetUrl } from "../content/asset-url";

/** Troop types in display order (rally choices, reports, ship passengers): every `soldier:*` entry. */
export const troopTypes: readonly MilitaryTroopType[] = MILITARY_TROOP_TYPES;

const FALLBACK_NATION = "roman";

/** One rendered portrait set for home, colony, recruitment, ships and troop selection (catalog army icon). */
export const troopIcon = (nation: string, type: MilitaryTroopType) => {
  const icon = soldierEntry(type)!.icon!;
  return resolveAssetUrl(icon, { key: type, nation }) ?? resolveAssetUrl(icon, { key: type, nation: FALLBACK_NATION })!;
};

/** The nation's soldier of that troop type, idle in its gear: the picture of troop lists. */
export const troopPortrait = (nation: string, type: MilitaryTroopType, rank?: number) => {
  const { path, ranked } = soldierEntry(type)!.soldier.portrait;
  const ownPortrait = ranked && rank !== undefined && resolveAssetUrl(ranked, { key: type, nation, rank });
  if (ownPortrait) return ownPortrait;
  return resolveAssetUrl(path, { key: type, nation }) ?? resolveAssetUrl(path, { key: type, nation: FALLBACK_NATION })!;
};

/** The actual national commander's face and helmet, framed as a close-up for every view. */
export const commanderPortrait = (nation: string) => {
  const icon = (commanderEntry(nation) ?? commanderEntry(FALLBACK_NATION)!).icon!;
  return resolveAssetUrl(icon, { key: nation })!;
};
