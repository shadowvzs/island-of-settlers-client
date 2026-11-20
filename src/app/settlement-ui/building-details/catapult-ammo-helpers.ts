import { type CatapultAmmoKind, catapultAmmoProfile } from "../../../shared/settlement/catapult-ammo-kinds";
import { CATAPULT_BASE_RANGE } from "../../../shared/settlement/military-catapult";

export interface CatapultAmmoFacts {
  damagePercent: number;
  flightPercent: number;
  impactPercent: number;
  rangePercent: number;
  rangeTiles: number;
  special?: "direct" | "split";
}

const percentChange = (multiplier: number) => Math.round((multiplier - 1) * 100);

/** Pure view data for the selected stone kind, derived from the shared ammunition profile. */
export const catapultAmmoFacts = (kind: CatapultAmmoKind): CatapultAmmoFacts => {
  const profile = catapultAmmoProfile(kind);
  const special = kind === "granite" ? "split" : kind === "marble" ? "direct" : undefined;
  return {
    damagePercent: percentChange(profile.damage),
    flightPercent: percentChange(profile.flightTime),
    impactPercent: percentChange(profile.impactRadius),
    rangePercent: percentChange(profile.range),
    rangeTiles: Math.round(CATAPULT_BASE_RANGE * profile.range * 10) / 10,
    ...(special ? { special } : {})
  };
};

/** "+50%", "−20%" or undefined when the value is unchanged. */
export const signedPercent = (percent: number) =>
  percent === 0 ? undefined : `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`;
