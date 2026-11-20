import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { PlayerItemId } from "../../shared/progression/player-inventory";
import { createLazyReactWindow } from "../components/lazy-react-window";
import { createExternalStore } from "../components/ui-store";
import { type InventoryMapKind, isInventoryItemVisible } from "./map-context";
import { INVENTORY_MESSAGES as M } from "./messages";

export const createInventoryWindow = (container: HTMLElement, onUse: (item:PlayerItemId) => void, i18n?: I18n,
  mapKind: () => InventoryMapKind = () => "home") => {
  const context = createExternalStore(mapKind());
  const inventory = createLazyReactWindow({
    className: "player-inventory-window", container, contentClassName: "player-inventory", i18n,
    heading: () => translateMessage(i18n, M.title), id: "player-inventory-title",
    load: async () => (await import("./mount")).createInventoryMount(item => {
      if (isInventoryItemVisible(item, mapKind())) onUse(item);
    }, context),
    texts: { error: () => translateMessage(i18n, M.failed), loading: () => translateMessage(i18n, M.loading) }
  });

  return { ...inventory, open: () => { context.set(mapKind()); inventory.open(); } };
};
