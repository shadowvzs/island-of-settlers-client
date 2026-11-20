const large = new Set<number>([
  37, 28, 9, 39, 7,
  0, 5, 27
]);
const houses = new Set<number>([
  33, 21, 31, 32, 26, 25, 24, 34, 36, 23, 40, 29, 4, 58, 59,
  3, 6, 8, 15
]);
const explicit: Partial<Record<number, readonly [number, number]>> = {
  1: [4, 4], 2: [5, 4], 4: [3, 4], 14: [3, 4], 18: [4, 4], 19: [4, 4], 20: [4, 4], 22: [4, 4],
  31: [5, 4], 35: [2, 2],
  // Early flax -> cloth producers: Small and within the planned farm/workshop envelopes.
  60: [3, 3], 61: [4, 4],
  // Commander's Lodge: Small, own courtyard for the mounted deployment route (provisional shell).
  62: [4, 4], 7: [9, 9], 16: [5, 5],
  // Residences (POP-02): small, medium and big plots without scaling the shared door.
  57: [4, 4], 58: [5, 5], 59: [6, 6]
};

type RomanPlotCategory = "large" | "house" | "mine" | "hut";

const PLOT_MINIMUM_BY_CATEGORY: Readonly<Record<RomanPlotCategory, readonly [number, number]>> = {
  house: [5, 5], hut: [4, 4], large: [6, 6], mine: [0, 0]
};

const getRomanPlotCategory = (typeId: number): RomanPlotCategory => {
  if (large.has(typeId)) return "large";
  if (houses.has(typeId)) return "house";
  if (typeId >= 10 && typeId <= 13) return "mine";
  return "hut";
};

/** Physical plot policy is independent of construction-menu categories. */
export const getRomanBuildingPlotPolicy = (typeId: number) => {
  const category = getRomanPlotCategory(typeId);
  const minimum: readonly [number, number] = explicit[typeId] ?? PLOT_MINIMUM_BY_CATEGORY[category];
  return { minimum, fillLargeModel: large.has(typeId), category };
};
