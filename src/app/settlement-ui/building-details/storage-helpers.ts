import type { I18n } from "@lingui/core";
import { isMaterialVisible } from "@shared/catalog/balance";

import { translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { isForeignDrinkWare } from "../../../shared/settlement/nation-drinks";
import { SETTLEMENT_WARES } from "../../../shared/settlement/settlement-building-policies";
import { isSharedStorageWare } from "../../../shared/settlement/shared-storage";
import { getSettlementInventoryEntries } from "../inventory";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../types";

/** Activate Collect, then toggle several canonical ware requests for the destination pool. */
export type StorageCollectTool = "collect" | null;
export type StoragePage = "resources" | "settlers" | "harbour" | "soldiers";
const selectableWares = new Set(SETTLEMENT_WARES.filter(isSharedStorageWare));

export const getStorageCollectTool = (
  building: SettlementBuildingSummary, options: SettlementUiOptions, tool: StorageCollectTool, i18n?: I18n
) => {
  const collect = building.storageCollect;
  if (!building.completed || building.hostile || !collect?.visible) return undefined;
  let title = translateMessage(i18n, M.details.storage.collectHint);
  if (collect.reason) title = translateDomainText(collect.reason, i18n);
  return { disabled: !collect.available || !options.onStorageCollect,
    label: translateMessage(i18n, M.details.storage.collect), pressed: tool === "collect", title };
};

/** One ware button: common counts, persistent collection selection and accessible details. */
export interface StorageCell {
  count: string;
  disabled: boolean;
  label: string;
  title?: string;
  /** Non-shared storage summary, or the compact shared-stock badges below. */
  pool?: string;
  poolTitle?: string;
  /** Shared stock reserved for outgoing loads; shown only when positive. */
  held?: number;
  /** Shared stock on the way; shown as a yellow +N badge when positive. */
  incoming?: number;
  collecting?: boolean;
  ware: string;
}

const HANDCART_NOTE = M.details.storage.handcartNote;
const storageProjection = (building: SettlementBuildingSummary) => {
  if (!building.completed || building.hostile) return undefined;
  return building.storage;
};

export const getStorageAria = (building: SettlementBuildingSummary, i18n?: I18n) => {
  if (storageProjection(building)) return translateMessage(i18n, M.details.storage.sharedAria);
  return translateMessage(i18n, M.details.storage.aria);
};

/** Every ware of the player's nation, anything else stored here, and the depot's hand carts. */
const getStorageInventory = (building: SettlementBuildingSummary, nation?: string) => {
  const nationWares = SETTLEMENT_WARES.filter(ware => !isForeignDrinkWare(ware, nation));
  const pool = storageProjection(building);
  const poolWares = [pool?.available, pool?.held, pool?.incoming, pool?.stored]
    .flatMap(goods => Object.keys(goods ?? {}));
  const wares = [...new Set([...nationWares, ...Object.keys(building.inventory ?? {}), ...poolWares,
    ...(building.storageCollect?.wares ?? []), "handcart"])];
  const inventory = Object.fromEntries(wares.map(ware => {
    if (pool && isSharedStorageWare(ware)) return [ware, pool.available[ware] ?? 0];
    return [ware, building.inventory?.[ware] ?? 0];
  }));
  inventory.handcart = building.storedHandcarts ?? inventory.handcart ?? 0;
  return inventory;
};

/** Carts belong to this depot: transport equipment, not transferable cargo, so never editable. */
const getHandcartCell = (
  building: SettlementBuildingSummary, name: string, count: number, i18n?: I18n
): StorageCell => {
  const active = Math.max(0, (building.totalHandcarts ?? count) - count);
  return {
    count: String(count), disabled: true,
    label: translateMessage(i18n, M.details.storage.handcart, {
      active, count, name, note: translateMessage(i18n, HANDCART_NOTE)
    }),
    ware: "handcart"
  };
};

interface InventoryEntry {
  count: number;
  name: string;
  ware: string;
}

const getWareCell = (
  building: SettlementBuildingSummary, editable: boolean, { count, name, ware }: InventoryEntry, i18n?: I18n
): StorageCell => {
  const shared = isSharedStorageWare(ware) ? storageProjection(building) : undefined;
  const pool = isSharedStorageWare(ware) ? building.storageCapacity : undefined;
  let pooled = pool
    ? translateMessage(i18n, M.details.storage.pooled, {
      capacity: pool.capacity, reserved: pool.reserved[ware] ?? 0, stored: pool.stored[ware] ?? 0
    })
    : "";
  let poolText = pool && `${pool.stored[ware] ?? 0} + ${pool.reserved[ware] ?? 0} / ${pool.capacity}`;
  let poolTitle: string | undefined;
  let held: number | undefined, incoming: number | undefined;
  if (shared) {
    const values = { available: count, capacity: shared.capacity, held: shared.held[ware] ?? 0,
      incoming: shared.incoming[ware] ?? 0, stored: shared.stored[ware] ?? 0 };
    pooled = translateMessage(i18n, M.details.storage.sharedPooled, values);
    poolText = undefined;
    // Compact badges replace the old sentence: held first, then the incoming +N in warning yellow.
    held = values.held > 0 ? values.held : undefined;
    incoming = values.incoming > 0 ? values.incoming : undefined;
    poolTitle = translateMessage(i18n, M.details.storage.sharedBadgeTitle, values);
  }
  const canCollect = selectableWares.has(ware);
  const collecting = canCollect && Boolean(building.storageCollect?.wares.includes(ware));
  const unavailable = !collecting && Boolean(building.storageCollect?.unavailableWares.includes(ware));
  let title: string | undefined;
  if (unavailable) title = translateMessage(i18n, M.details.storage.collectElsewhere);
  let collectingText = "";
  if (collecting) collectingText = translateMessage(i18n, M.details.storage.collectSelected);
  let label = translateMessage(i18n, M.details.storage.wareCell, { count, name, pooled, collecting: collectingText });
  if (title) label += ` · ${title}`;
  return {
    collecting: canCollect ? collecting : undefined,
    count: String(count), disabled: !editable || !canCollect || unavailable,
    held, incoming, label,
    pool: poolText, poolTitle, title, ware
  };
};

/** The ware buttons of a headquarters / storehouse / harbour Resources page, in inventory order. */
export const getStorageCells = (
  building: SettlementBuildingSummary, options: SettlementUiOptions, nation?: string, playerLevel = 1,
  i18n?: I18n, tool: StorageCollectTool = null
) => {
  const editable = Boolean(building.completed && !building.hostile && tool === "collect" &&
    building.storageCollect?.visible && building.storageCollect.available && options.onStorageCollect);
  const pool = storageProjection(building);
  return getSettlementInventoryEntries(getStorageInventory(building, nation))
    .filter(({ count, ware }) => building.storageCollect?.wares.includes(ware) || isMaterialVisible(ware, playerLevel,
      count + (pool?.held[ware] ?? 0) + (pool?.incoming[ware] ?? 0)))
    .map(entry =>
    entry.ware === "handcart"
      ? getHandcartCell(building, entry.name, entry.count, i18n)
      : getWareCell(building, editable, entry, i18n));
};

/** The simulation owns selected wares, not the panel draft; revalidate before each toggle. */
export const applyStorageCollect = (
  building: SettlementBuildingSummary, options: SettlementUiOptions, tool: StorageCollectTool, ware: string
) => {
  if (tool !== "collect" || !building.completed || building.hostile || !building.storageCollect?.visible ||
    !building.storageCollect.available || !selectableWares.has(ware)) return false;
  if (!building.storageCollect.wares.includes(ware) && building.storageCollect.unavailableWares.includes(ware))
    return false;
  return options.onStorageCollect?.(Number(building.id), ware, !building.storageCollect.wares.includes(ware));
};

/** Capacity sentence above the grid; null when the island reports no pooled capacity. */
export const getStorageCapacityText = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const shared = storageProjection(building);
  if (shared) return translateMessage(i18n, M.details.storage.sharedCapacity, { capacity: shared.capacity });
  if (!building.storageCapacity) return null;
  return translateMessage(i18n, M.details.storage.capacity, {
    capacity: building.storageCapacity.capacity,
    note: translateMessage(i18n, M.details.storage.capacityNote)
  });
};

/**
 * The register button cycles Resources -> Settlers -> [Harbour] -> Soldiers -> Resources.
 * The harbour page sits directly after Settlers and only exists for harbours.
 */
export const getStoragePageToggle = (page: StoragePage, i18n?: I18n, hasHarbour = false) => {
  let next: StoragePage = "resources";
  if (page === "resources") next = "settlers";
  else if (page === "settlers") next = hasHarbour ? "harbour" : "soldiers";
  else if (page === "harbour") next = "soldiers";
  let message = M.details.storage.showResources;
  if (next === "settlers") message = M.details.storage.showSettlers;
  else if (next === "harbour") message = M.details.storage.showHarbour;
  else if (next === "soldiers") message = M.details.storage.showSoldiers;
  return { label: translateMessage(i18n, message), next, pressed: page !== "resources" };
};
