import { wareEntries } from "@shared/catalog";

import { isMaterialWare } from "./advanced-material-variants";

/** A ware key (`ware:<key>` in the shared content catalog). */
export type WareId = string;

/** Wares carriers move as goods, in catalog order (horses and hand carts are `notCarried`). */
export const WARE_IDS: readonly WareId[] = Object.freeze(wareEntries()
  .filter(entry => !entry.tags.includes("notCarried")).map(entry => entry.key));
export const TOOL_WARES: ReadonlySet<WareId> = new Set(wareEntries()
  .filter(entry => entry.tags.includes("tool")).map(entry => entry.key));
const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");
const byName = new Map(WARE_IDS.map((id) => [normalize(id), id]));
const aliases = new Map(wareEntries().flatMap(entry => (entry.ware.aliases ?? []).map(alias => [alias, entry.key])));
export const resolveWareId = (value: string): WareId | null =>
  byName.get(normalize(value)) ?? aliases.get(normalize(value)) ?? null;
/** Player-facing descriptions for wares whose use is not obvious from the name alone. */
export const WARE_DESCRIPTIONS: Readonly<Partial<Record<WareId, string>>> = Object.freeze(Object.fromEntries(
  wareEntries().flatMap(entry => entry.text.description ? [[entry.key, entry.text.description.en]] : [])));
/** A cargo box (owner, 2026-10-21): trade wares and ship cargo are carried as closed crates, never as the goods.
 * A visual id only, not a ware of the economy.
 */
export const CARGO_BOX_WARE = "cargoBox";
/** Render-only coin packaging; never an economic ware or an inventory item. */
export const COIN_CHEST_WARE = "coinChest";
export const COIN_CARGO_VISUALS = [COIN_CHEST_WARE, "coinChestStack", "coinChestOverCrate", "coinChestUnderCrate"] as const;
export const cargoCarryWare = (ware: string, secondWare?: string) => {
  if (!secondWare) return ware === "coins" ? COIN_CHEST_WARE : CARGO_BOX_WARE;
  if (ware === "coins") return secondWare === "coins" ? "coinChestStack" : "coinChestUnderCrate";
  return secondWare === "coins" ? "coinChestOverCrate" : CARGO_BOX_WARE;
};
export const coinCargoStack = (visual: string): readonly string[] | undefined => {
  if (visual === "coinChestStack") return [COIN_CHEST_WARE, COIN_CHEST_WARE];
  if (visual === "coinChestOverCrate") return [CARGO_BOX_WARE, COIN_CHEST_WARE];
  if (visual === "coinChestUnderCrate") return [COIN_CHEST_WARE, CARGO_BOX_WARE];
  return undefined;
};
/** Light ingredients are cradled in front, using the shared two-hand support rig. */
export const HAND_CARRIED_INGREDIENTS: readonly string[] = Object.freeze(wareEntries()
  .filter(entry => entry.ware.handCarried).map(entry => entry.key));
/**
 * Owner 2026-11-11 (FISHER-BOAT): every carrier lifts a boat overhead with raised arms. The overhead
 * clip is a Codex task; until it lands the renderer keeps the shoulder carry for these wares.
 */
export const isOverheadCarriedWare = (ware: string) => resolveWareId(ware) === "boat";
export const getWareCarryAction = (ware: string) => {
  const id = resolveWareId(ware);
  if (ware === CARGO_BOX_WARE || COIN_CARGO_VISUALS.some(visual => visual === ware)) return "carry_shoulder";
  if (isOverheadCarriedWare(ware)) return "carry_shoulder";
  return id === "logs" || id === "planks" || id === "stone" ||
    (id !== null && isMaterialWare(id)) || id === "meat"
    ? "carry_shoulder" : "carry_back";
};
