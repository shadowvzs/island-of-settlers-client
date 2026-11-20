import { wareNameForCount } from "../../shared/settlement/ware-names";

/** One shared formatter: `toLocaleString` builds a new one per call (measurable on the 0.5 s HUD tick). */
const wholeNumbers = new Intl.NumberFormat("en-US");

/** A rounded whole number grouped like "1,000" (experience, gems, ware counts). */
/** " (−25% talent)" when a talent changes the shown value, else "" (labels follow the rules' talent values). */
export const talentChangeSuffix = (share: number, less = false) => {
  if (share <= 0) return "";
  return ` (${less ? "−" : "+"}${Math.round(share * 100)}% talent)`;
};

export const formatWholeNumber = (value: number) => wholeNumbers.format(Math.round(value));

/** "people / limit"; only the count on an island without a limit (an adventure). */
export const formatPopulation = (population: number, limit?: number) =>
  limit === undefined ? formatWholeNumber(population) : `${formatWholeNumber(population)} / ${formatWholeNumber(limit)}`;

/** "<count> <ware name>" with the count grouped ("1,000") and the name in the right number. */
export const formatWareCount = (count: number, ware: string) =>
  `${formatWholeNumber(count)} ${wareNameForCount(ware, count)}`;

/** A goods list for notices: "100 Logs, 5 Swords". */
export const describeWares = (goods: Readonly<Record<string, number>>) =>
  Object.entries(goods).map(([ware, count]) => formatWareCount(count, ware)).join(", ");
