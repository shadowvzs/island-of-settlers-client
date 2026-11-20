import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { InventoryPanel } from "../src/app/player-inventory/inventory-panel";
import { createInventorySlots } from "../src/app/player-inventory/layout";
import { NationChooserPanel } from "../src/app/player-inventory/nation-chooser-panel";
import { bindPlayerInventorySession, playerInventoryView } from "../src/app/player-inventory/store";
import { HotkeySection } from "../src/app/settings/hotkeys/hotkey-section";
import { renderWithI18n } from "./helpers/render-with-i18n";

describe("personal inventory slots",()=>{
  it("releases fifty session subscriptions and ignores stale session notifications",()=>{
    const listeners = new Set<()=>void>();
    const subscribeInventory = (listener:()=>void) => {
      listeners.add(listener);
      return ()=>{ listeners.delete(listener); };
    };
    for (let cycle = 0; cycle < 50; cycle++) {
      const close = bindPlayerInventorySession({ progress:()=>({ inventory:{ chooseNation:1 } }),subscribeInventory });
      const late = [...listeners][0]!;
      expect(playerInventoryView.getSnapshot()).toEqual({ chooseNation:1 });
      close(); late();
      expect(listeners.size).toBe(0);
      expect(playerInventoryView.getSnapshot()).toEqual({});
    }
  });
  it("offers a separate confirmation panel with the current nation disabled and no initial selection",()=>{
    playerInventoryView.set({ chooseNation:1 });
    const markup=renderWithI18n(createElement(NationChooserPanel,{ onClose:vi.fn(),setNation:vi.fn() }));
    expect(markup).toMatch(/data-nation="roman" disabled=""/);
    expect(markup).toMatch(/disabled="" type="button">Confirm<\/button>/);
    expect(markup).toContain('>Cancel</button>');
    expect(markup).not.toContain('aria-checked="true"');
    playerInventoryView.set({});
  });
  it("shows64 slots even when empty and aggregates each type into one slot",()=>{
    expect(createInventorySlots({})).toHaveLength(64);
    const slots = createInventorySlots({ tea:20, stone:9, empty:0 });
    expect(slots).toHaveLength(64);
    expect(slots.filter(Boolean)).toEqual([{ count:9,id:"stone" },{ count:20,id:"tea" }]);
  });
  it("adds complete scrollable rows only above64 distinct item types",()=>{
    const items = Object.fromEntries(Array.from({ length:65 },(_,i)=>[`item-${i}`,1]));
    const slots = createInventorySlots(items);
    expect(slots).toHaveLength(72);
    expect(slots.filter(Boolean)).toHaveLength(65);
  });
  it("renders empty slots without focus targets and one accessible owned slot without a footer",()=>{
    playerInventoryView.set({});
    const empty = renderWithI18n(createElement(InventoryPanel,{ onUse:vi.fn() }));
    expect([...empty.matchAll(/data-inventory-slot=/g)]).toHaveLength(64);
    expect(empty).not.toContain('data-item-id=');
    expect([...empty.matchAll(/role="tab"/g)]).toHaveLength(3);
    playerInventoryView.set({ commanderRecovery:1 });
    const owned = renderWithI18n(createElement(InventoryPanel,{ onUse:vi.fn() }));
    expect([...owned.matchAll(/data-inventory-slot=/g)]).toHaveLength(64);
    expect([...owned.matchAll(/data-item-id="commanderRecovery"/g)]).toHaveLength(1);
    expect(owned).toContain('aria-label="Commander recovery, quantity 1"');
    expect(owned).not.toContain('>Use</button>');
    expect(owned).not.toContain('<article');
    playerInventoryView.set({});
  });
});

describe("hotkey subcategories",()=>{
  it("defaults toGeneral and keepsPossessed controls in their hidden accessible subtab",()=>{
    const markup = renderWithI18n(createElement(HotkeySection));
    expect(markup).toMatch(/aria-controls="settings-hotkeys-panel-game" aria-selected="true"[^>]*>General<\/button>/);
    expect(markup).toMatch(/aria-controls="settings-hotkeys-panel-possessed" aria-selected="false"[^>]*>Possessed mode<\/button>/);
    expect(markup).toContain('hidden="" id="settings-hotkeys-panel-possessed"');
    expect(markup).toContain('aria-label="Move forward"');
  });
});
