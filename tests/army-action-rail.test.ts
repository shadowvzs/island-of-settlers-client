import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { createDevelopmentTool } from "../src/app/settings/development/development-tool";
import { ArmyRailContent } from "../src/app/settlement/army-rail/army-rail-view";
import {
  type ArmyRailState, getActionButtons, getArmyRailView, getChosenTypes, getOrderInstruction,
  INITIAL_ARMY_RAIL_STATE, toTroopCounts
} from "../src/app/settlement/army-rail/helpers";
import type { MilitaryDebugControls } from "../src/app/settlement/military-debug/helpers";
import { MilitaryDebugSection } from "../src/app/settlement/military-debug/military-debug-section";

const noop = () => undefined;
const state = (fields: Partial<ArmyRailState>): ArmyRailState => ({ ...INITIAL_ARMY_RAIL_STATE, ...fields });
const actions = {
  closeRally: noop, setAdding: noop, onAction: noop, onCancelRally: noop, onChooseRallyPoint: noop,
  onGather: noop, onRecallGroup: noop, onToggleAdding: noop, onToggleRally: noop, onToggleType: noop
};
const i18n = setupI18n({ locale: "en", messages: { en: {} } });
const renderRail = (fields: Partial<ArmyRailState>) => renderToStaticMarkup(createElement(I18nProvider, { i18n },
  createElement(ArmyRailContent, { actions, store: createExternalStore(state(fields)) })));
const renderMilitaryDebug = (debug: Parameters<typeof MilitaryDebugSection>[0]["debug"]) =>
  renderToStaticMarkup(createElement(I18nProvider, { i18n },
    createElement(MilitaryDebugSection, { debug })));

describe("army action rail", () => {
  it("sends only checked troop types that have free soldiers", () => {
    const free = toTroopCounts([{ count: 3, type: "shield" }, { count: 2, type: "archer" }]);
    expect(free).toEqual({ archer: 2, cavalry: 0, heavy: 0, shield: 3 });
    expect(getChosenTypes({ checked: { ...INITIAL_ARMY_RAIL_STATE.checked, archer: false }, free }))
      .toEqual(["shield"]);
  });

  it("presses the pending order, explains it and keeps Enter off for cavalry", () => {
    const buttons = getActionButtons(state({ canEnter: false, order: "attack" }));
    expect(buttons.map(button => button.label)).toEqual(["Move", "Attack / attack move",
      "Retreat (ignores enemies)", "Return to closest storehouse", "Enter military building (infantry)"]);
    expect(buttons.filter(button => button.pressed).map(button => button.action)).toEqual(["attack"]);
    expect(buttons[4]).toMatchObject({ disabled: true, title: "Select foot soldiers to enter a military building" });
    expect(getOrderInstruction("rally")).toBe("Choose where to plant the rally banner. Press Escape to cancel.");
    expect(getOrderInstruction(null)).toBe("Choose a soldier action.");
  });

  it("shows the gather and cancel actions only with a banner, and the empty note without free troops", () => {
    expect(getArmyRailView(state({}))).toMatchObject({
      actionsHidden: true, cancelRallyHidden: true, emptyHidden: false, gatherDisabled: true, gatherHidden: true,
      selectedCount: ""
    });
    const free = toTroopCounts([{ count: 1, type: "heavy" }]);
    expect(getArmyRailView(state({ free, hasBanner: true, selected: 4 }))).toMatchObject({
      actionsHidden: false, cancelRallyHidden: false, emptyHidden: true, gatherDisabled: false,
      gatherHidden: false, selectedCount: "4"
    });
  });

  it("renders the names, pressed and expanded states the game and e2e tests use", () => {
    const free = toTroopCounts([{ count: 2, type: "shield" }]);
    const markup = renderRail({ adding: true, free, hasBanner: true, order: "rally", rallyOpen: true, selected: 2 });
    for (const name of ["Select troops", "Choose rally point", "Cancel rally point", "Close troop selection",
      "Send the chosen troops to the rally banner", "Attack / attack move", "Box select"])
      expect(markup).toContain(`aria-label="${name}"`);
    expect(markup).toContain('aria-expanded="true" aria-label="Select troops"');
    expect(markup).toContain('aria-label="Choose rally point" aria-pressed="true"');
    expect(markup).toContain('aria-label="Box select" aria-pressed="true"');
    expect(markup).toContain('<section aria-label="Select troop types" class="army-action-rail__rally">');
    expect(markup).toContain('aria-label="Select shield soldiers" type="checkbox" checked=""');
    expect(markup).toContain('aria-label="Select heavy soldiers" disabled="" type="checkbox" checked=""');
    expect(markup).toContain('<span aria-live="polite" class="army-action-rail__count">2</span>');
    const closed = renderRail({});
    expect(closed).toContain('class="army-action-rail__rally" hidden=""');
    expect(closed).toMatch(/aria-label="Cancel rally point"[^>]*hidden=""/);
  });
});

describe("military development section", () => {
  it("renders the tool grid once the settlement exists", () => {
    const debug = createExternalStore<MilitaryDebugControls | null>(null);
    expect(renderMilitaryDebug(debug)).toBe("");
    const tool = createDevelopmentTool({ icon: "x.png", label: "Start training", title: "Start", onClick: noop });
    debug.set({ hidden: createExternalStore(false), tools: [tool] });
    const markup = renderMilitaryDebug(debug);
    expect(markup).toContain('<section aria-label="Military development actions">');
    expect(markup).toContain('<button aria-label="Start training"');
  });
});
