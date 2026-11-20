import { talentModifiers, type TalentRanks } from "./talents";

/** Quest coins, material and its kind are shared balance (`@shared/catalog/balance`); the talent bonus is here. */
const questBonus = (talents: TalentRanks) => 1 + talentModifiers(talents).questRewards;

/** A quest's experience with the daily quest talent. */
export const questRewardExperience = (talents: TalentRanks, experience: number) =>
  Math.round(experience * questBonus(talents));

/** A quest's goods with the daily quest talent, rounded per ware. */
export const questRewardGoods = (talents: TalentRanks, goods: Readonly<Record<string, number>>) => {
  const bonus = questBonus(talents);
  return Object.fromEntries(Object.entries(goods).map(([ware, count]) => [ware, Math.round(count * bonus)]));
};
