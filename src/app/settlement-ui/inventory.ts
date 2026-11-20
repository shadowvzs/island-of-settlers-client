import type { I18n } from "@lingui/core";
import { wareEntries, wareEntry } from "@shared/catalog";
import { isMaterialVisible } from "@shared/catalog/balance";

import unknownWareIconUrl from "../../../assets/ui-icons/actions/warehouse.webp?url";
import { translateMessage } from "../../shared/i18n/translate";
import { wareDisplayName } from "../../shared/settlement/ware-names";
import { resolveAssetUrl } from "../content/asset-url";
import { SETTLEMENT_MESSAGES as M } from "./messages";

const renderedWareIcon = (ware: string) => {
  const icon = wareEntry(ware)?.icon;
  return icon && resolveAssetUrl(icon, { key: ware });
};

/**
 * The rendered 3D icon of a ware (its content catalog `icon`); an unknown ware id (e.g. from a legacy save) gets the
 * generic warehouse render. Every catalogue ware has its own render (guarded by a test).
 */
export const getWareIconSource = (ware: string) => renderedWareIcon(ware) ?? unknownWareIconUrl;

/** True when the ware has its own rendered icon (tests guard that every catalogue ware does). */
export const hasRenderedWareIcon = (ware: string) => renderedWareIcon(ware) !== undefined;

// The catalog's ware order (owner decision 2026-11-11); unknown saved wares stay visible, sorted last.
const inventoryWarePositions = new Map(wareEntries().map(({ key }, index) => [key, index]));

export const getSettlementInventoryEntries = (inventory: Readonly<Record<string, number>> = {}, playerLevel?: number) =>
  Object.entries(inventory)
    .filter(([ware, count]) => playerLevel === undefined || isMaterialVisible(ware, playerLevel, count))
    .sort(([left], [right]) =>
      (inventoryWarePositions.get(left) ?? Infinity) - (inventoryWarePositions.get(right) ?? Infinity)
      || left.localeCompare(right))
    .map(([ware, count]) => ({ ware, count, name: wareDisplayName(ware) }));

/** One stock cell, ready to render: ware, label, count text and accessible name. */
export const getInventoryCells = (inventory?: Readonly<Record<string, number>>) =>
  getSettlementInventoryEntries(inventory).map(({ count, name, ware }) =>
    ({ count: String(count), label: `${name}: ${count}`, name, ware }));

/** Text under an empty stock grid: known but empty, or stock not reported. */
export const getInventoryEmptyText = (inventory?: Readonly<Record<string, number>>, i18n?: I18n) =>
  translateMessage(i18n, inventory ? M.inventory.empty : M.inventory.unavailable);
