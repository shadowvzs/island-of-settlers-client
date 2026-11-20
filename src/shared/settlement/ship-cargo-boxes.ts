import { wareEntries } from "@shared/catalog";

/**
 * Relative box sizes of the wares, by weight and bulk (content catalog `ware.boxSize`): logs are the bulkiest (3),
 * sacks of ore the most compact (16). A box always holds a single ware type; unknown save ids use the default.
 */
const DEFAULT_BOX_SIZE = 5;
const WARE_BOX_SIZES: ReadonlyMap<string, number> =
  new Map(wareEntries().map(entry => [entry.key, entry.ware.boxSize]));

/** Every box holds five times its relative size (owner, 2026-10-21: logs 15, stone 20, coins 250). */
const BOX_SIZE_FACTOR = 5;

/** Units of one ware in a cargo box; a boat is always a box of its own. */
export const wareBoxUnits = (ware: string) =>
  ware === "boat" ? 1 : (WARE_BOX_SIZES.get(ware) ?? DEFAULT_BOX_SIZE) * BOX_SIZE_FACTOR;

export const boxesFor = (ware: string, count: number) => Math.ceil(Math.max(0, count) / wareBoxUnits(ware));

export const cargoBoxes = (goods: Readonly<Record<string, number>>) =>
  Object.entries(goods).reduce((sum, [ware, count]) => sum + boxesFor(ware, count), 0);

/** One visible box: a single ware and how many units of it the box holds. */
export interface CargoBox { count: number; ware: string }

/**
 * Visible boxes per ware when a cargo is shown in fewer boxes than it fills (a logistics visitor's hold is
 * shown as at most a full deck): shares in proportion to the ware's real boxes, at least one box per ware,
 * largest remainders first (ties in ware order).
 */
const apportion = (real: readonly number[], boxes: number) => {
  const total = real.reduce((sum, count) => sum + count, 0);
  const quotas = real.map(count => boxes * count / total);
  const shares = quotas.map(quota => Math.max(1, Math.floor(quota)));
  const pick = (more: boolean) => quotas.map((quota, index) => ({ index, rest: quota - shares[index]! }))
    .filter(({ index }) => more || shares[index]! > 1)
    .sort((a, b) => (more ? b.rest - a.rest : a.rest - b.rest) || a.index - b.index)[0]!.index;
  let left = boxes - shares.reduce((sum, count) => sum + count, 0);
  for (; left > 0; left--) shares[pick(true)]!++;
  for (; left < 0; left++) shares[pick(false)]!--;
  return shares;
};

/** `boxes` boxes of `count` units of a ware: equal shares of `share` units, the last box holding the rest. */
const splitWare = (ware: string, count: number, boxes: number, share = Math.floor(count / boxes)): CargoBox[] =>
  Array.from({ length: boxes }, (_, index) =>
    ({ count: index < boxes - 1 ? share : count - share * (boxes - 1), ware }));

/**
 * The one box rule for every cargo transfer (owner, 2026-10-20), pier porters and lighters alike: the value
 * of each visible box, in transfer order. A cargo shown box by box fills boxes of `wareBoxUnits` (the last box
 * of a ware holds the rest); a cargo shown in fewer boxes (`visible`) spreads each ware's units over its share
 * of them in equal shares, the last box holding the remainder, so the whole cargo has moved exactly when the
 * last box has.
 */
export const cargoBoxValues = (
  cargo: Readonly<Record<string, number>>, visible = cargoBoxes(cargo)
): CargoBox[] => {
  const wares = Object.entries(cargo).filter(([, count]) => count > 0);
  const real = wares.map(([ware, count]) => boxesFor(ware, count));
  const total = real.reduce((sum, count) => sum + count, 0);
  if (!total) return [];
  if (visible >= total)
    return wares.flatMap(([ware, count], index) => splitWare(ware, count, real[index]!, wareBoxUnits(ware)));
  const shares = apportion(real, Math.max(visible, wares.length));
  return wares.flatMap(([ware, count], index) => splitWare(ware, count, shares[index]!));
};
