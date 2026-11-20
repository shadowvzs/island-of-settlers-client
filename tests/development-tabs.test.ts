import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { renderWithI18n } from "./helpers/render-with-i18n";
import { describe, expect, it } from "vitest";

import { getNextTabIndex, getTabRows } from "../src/app/components/helpers";
import { Tabs } from "../src/app/components/tabs";
import { DevelopmentTabs } from "../src/app/settings/development/development-tabs-panel";
import { type DevelopmentTool, mergeDevelopmentGroups } from "../src/app/settings/development/helpers";

const ITEMS = [
  { content: "World tools", id: "world", label: "World" },
  { content: "Economy tools", id: "economy", label: "Economy" },
  { content: "Diagnostics tools", id: "diagnostics", label: "Diagnostics" }
];

describe("tab helpers", () => {
  it("moves with wrapping arrows and Home / End, ignoring other keys", () => {
    expect(getNextTabIndex("ArrowRight", 2, 3)).toBe(0);
    expect(getNextTabIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(getNextTabIndex("Home", 2, 3)).toBe(0);
    expect(getNextTabIndex("End", 0, 3)).toBe(2);
    expect(getNextTabIndex("Enter", 1, 3)).toBeNull();
  });

  it("prepares ids, selection and the roving tab index", () => {
    expect(getTabRows("development", ITEMS, 1).map(({ panelId, selected, tabId, tabIndex }) =>
      ({ panelId, selected, tabId, tabIndex }))).toEqual([
      { panelId: "development-panel-world", selected: false, tabId: "development-tab-world", tabIndex: -1 },
      { panelId: "development-panel-economy", selected: true, tabId: "development-tab-economy", tabIndex: 0 },
      { panelId: "development-panel-diagnostics", selected: false, tabId: "development-tab-diagnostics", tabIndex: -1 }
    ]);
  });

  it("merges development groups by id and drops empty ones", () => {
    const button = (name: string) => ({ label: name }) as unknown as DevelopmentTool;
    const section = { checked: false, kind: "reveal-ore", onChange: () => undefined } as const;
    const tabs = mergeDevelopmentGroups([
      { buttons: [button("editor")], id: "world", label: "World" },
      { id: "empty", label: "Empty" },
      { buttons: [button("fog")], id: "world", label: "Ignored", sections: [section] }
    ]);
    expect(tabs).toEqual([
      { buttons: [button("editor"), button("fog")], id: "world", label: "World", sections: [section] }
    ]);
  });
});

describe("tabs markup", () => {
  it("renders an ARIA tablist with every panel mounted, only the first visible", () => {
    const markup = renderToStaticMarkup(createElement(Tabs, {
      idPrefix: "development", items: ITEMS, label: "Development categories",
      listClassName: "development-menu__tabs", panelClassName: "development-menu__tab-content"
    }));
    expect(markup).toContain('<div aria-label="Development categories" class="development-menu__tabs" role="tablist">');
    expect(markup).toContain('<button aria-controls="development-panel-world" aria-selected="true" '
      + 'id="development-tab-world" role="tab" tabindex="0" type="button">World</button>');
    expect(markup).toContain('<button aria-controls="development-panel-economy" aria-selected="false" '
      + 'id="development-tab-economy" role="tab" tabindex="-1" type="button">Economy</button>');
    expect(markup).toContain('<section aria-labelledby="development-tab-world" class="development-menu__tab-content" '
      + 'id="development-panel-world" role="tabpanel" tabindex="0">World tools</section>');
    expect(markup).toContain('<section aria-labelledby="development-tab-diagnostics" '
      + 'class="development-menu__tab-content" hidden="" id="development-panel-diagnostics" role="tabpanel" '
      + 'tabindex="0">Diagnostics tools</section>');
  });

  it("renders each development tab's content inside its panel", () => {
    const markup = renderWithI18n(createElement(DevelopmentTabs, {
      tabs: [{ id: "world", label: "World", sections: [] },
        { id: "appearance", label: "Appearance", sections: [] }]
    }));
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('id="development-tab-appearance"');
    expect(markup).toContain('id="development-panel-world" role="tabpanel" tabindex="0"><div></div></section>');
  });
});
