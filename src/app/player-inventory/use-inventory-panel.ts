import { useLingui } from "@lingui/react";
import { type KeyboardEvent, useState } from "react";

import { useExternalStore } from "../components/external-store";
import { createExternalStore, type ReadableStore } from "../components/ui-store";
import { selectTabByKey } from "../components/use-tabs";
import { activeInventoryTab, getInventoryTabs, inventoryForTab, type InventoryTab, isInventoryTabEnabled } from "./categories";
import { playerItemName } from "./item-presentation";
import { createInventorySlots } from "./layout";
import { type InventoryMapKind, visiblePlayerInventory } from "./map-context";
import { INVENTORY_MESSAGES as M } from "./messages";
import { playerInventoryView } from "./store";

export const HOME_INVENTORY_CONTEXT = createExternalStore<InventoryMapKind>("home");
export const useInventoryPanel = (context: ReadableStore<InventoryMapKind>) => {
  const { i18n } = useLingui();
  const inventory = useExternalStore(playerInventoryView);
  const kind = useExternalStore(context);
  const [draft, setDraft] = useState<InventoryTab>("battle");
  const selected = activeInventoryTab(draft, kind);
  const tabs = getInventoryTabs(selected, kind, i18n);
  const enabled = tabs.filter(tab => !tab.disabled);
  const select = (id: InventoryTab) => { if (isInventoryTabEnabled(id, kind)) setDraft(id); };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: InventoryTab) => {
    const index = enabled.findIndex(tab => tab.id === id);
    if (index < 0) return;
    selectTabByKey(event, index, enabled, next => select(enabled[next]!.id));
  };
  const slots = createInventorySlots(inventoryForTab(visiblePlayerInventory(inventory, kind), selected))
    .map((slot, index) => {
      if (!slot) return { index, item: null, label: "" };
      return { index, item: slot,
        label: i18n._({ ...M.slotLabel, values: { count: slot.count, item: playerItemName(slot.id, i18n) } }) };
    });
  return { categoriesLabel: i18n._(M.categories), selectedTabId: `player-inventory-tab-${selected}`,
    slots, tabs, title: i18n._(M.title), onTabKeyDown, onTabSelect: select };
};
