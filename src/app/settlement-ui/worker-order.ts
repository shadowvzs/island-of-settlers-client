import { categoriesOfKind, entriesOfKind, settlerEntries } from "@shared/catalog";

/** Jobs of this category sort alphabetically with unknown roles (content catalog `settler.other`). */
const UNORDERED_CATEGORY = "settler.other";

/**
 * Profession progression adapted to this game's actual trades: the catalog's settler categories in display order,
 * each in file order, then the troop roles ("Shield", "Heavy", "Archer": capitalized active `soldier:*` keys).
 * Jobs of the unordered category and unknown roles share one slot before the military.
 */
const createJobOrder = () => {
  const categoryOrder = new Map(categoriesOfKind("settler").map((category, index) => [category.id, index]));
  const ordered = settlerEntries().filter(entry => entry.category !== UNORDERED_CATEGORY)
    .sort((first, second) => categoryOrder.get(first.category)! - categoryOrder.get(second.category)!);
  const troopRoles = entriesOfKind("soldier").map(entry => `${entry.key.charAt(0).toUpperCase()}${entry.key.slice(1)}`);
  const jobs = [...ordered.map(entry => entry.settler.job), ...troopRoles];
  const order = new Map(jobs.map((job, index) => [job, index]));
  const unordered = ordered.findIndex(entry => categoryOrder.get(entry.category)! >
    categoryOrder.get(UNORDERED_CATEGORY)!) - .5;
  return { order, unordered };
};

let jobOrder: ReturnType<typeof createJobOrder> | null = null;

/** Unknown roles sort alphabetically after civilian professions, keeping military last. */
export const compareWorkerJobs = (left: string, right: string) => {
  jobOrder ??= createJobOrder();
  const { order, unordered } = jobOrder;
  const difference = (order.get(left) ?? unordered) - (order.get(right) ?? unordered);
  if (difference) return difference;
  return left < right ? -1 : Number(left > right);
};
