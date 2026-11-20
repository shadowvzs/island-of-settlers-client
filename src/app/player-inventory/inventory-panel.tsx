import type { PlayerItemId } from "../../shared/progression/player-inventory";
import type { ReadableStore } from "../components/ui-store";
import { PlayerItemIcon } from "./item-icon";
import type { InventoryMapKind } from "./map-context";
import { HOME_INVENTORY_CONTEXT, useInventoryPanel } from "./use-inventory-panel";

export const InventoryPanel = ({ context = HOME_INVENTORY_CONTEXT, onUse }: {
  context?: ReadableStore<InventoryMapKind>; onUse: (item:PlayerItemId) => void
}) => {
  const model = useInventoryPanel(context);
  return (
    <>
      <div aria-label={model.categoriesLabel} className="player-inventory__tabs" role="tablist">
        {model.tabs.map(tab => <button aria-controls="player-inventory-items" aria-disabled={tab.disabled}
          aria-selected={tab.selected} className="settlement-ui__tab" disabled={tab.disabled} id={tab.tabId}
          key={tab.id} role="tab" tabIndex={tab.tabIndex} type="button"
          onClick={() => model.onTabSelect(tab.id)} onKeyDown={event => model.onTabKeyDown(event, tab.id)}>
          {tab.label}
        </button>)}
      </div>
      <div aria-labelledby={model.selectedTabId} className="player-inventory__viewport"
        id="player-inventory-items" role="tabpanel">
        <div aria-label={model.title} className="player-inventory__grid" role="list">
          {model.slots.map(slot => {
            if (!slot.item) return <div aria-hidden="true" className="player-inventory__slot is-empty"
              data-inventory-slot={slot.index} key={slot.index} />;
            return (
              <div data-inventory-slot={slot.index} key={slot.index} role="listitem">
                <button aria-haspopup="dialog" aria-label={slot.label} className="player-inventory__slot"
                  data-item-id={slot.item.id} title={slot.label} type="button" onClick={()=>onUse(slot.item!.id)}>
                  <PlayerItemIcon item={slot.item.id} />
                  <span className="player-inventory__quantity">{slot.item.count}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
