import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollapsibleSection } from "../src/app/components/collapsible-section";
import {
  getCollapseStorageKey,
  readSectionOpen,
  toggleSectionOpen
} from "../src/app/components/use-collapsible-section";

const SECTION_ID = "graphics.visualFeatures";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

const renderSection = () => renderToStaticMarkup(createElement(CollapsibleSection, {
  children: createElement("p", null, "Inner content"),
  id: SECTION_ID,
  summary: "10 of 10 on",
  title: "Visual features"
}));

afterEach(() => vi.unstubAllGlobals());

describe("collapsible section state", () => {
  it("is collapsed by default", () => {
    expect(readSectionOpen(memoryStorage(), SECTION_ID)).toBe(false);
    expect(readSectionOpen(undefined, SECTION_ID)).toBe(false);
  });

  it("restores the remembered open state", () => {
    expect(readSectionOpen(memoryStorage({ [getCollapseStorageKey(SECTION_ID)]: "1" }), SECTION_ID))
      .toBe(true);
    expect(readSectionOpen(memoryStorage({ [getCollapseStorageKey(SECTION_ID)]: "0" }), SECTION_ID))
      .toBe(false);
  });

  it("toggles and persists the next state", () => {
    const storage = memoryStorage();
    const opened = toggleSectionOpen(storage, SECTION_ID, false);
    expect(opened).toBe(true);
    expect(readSectionOpen(storage, SECTION_ID)).toBe(true);
    expect(toggleSectionOpen(storage, SECTION_ID, opened)).toBe(false);
    expect(readSectionOpen(storage, SECTION_ID)).toBe(false);
  });

  it("still works when the storage throws", () => {
    const throwing = {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); }
    };
    expect(readSectionOpen(throwing, SECTION_ID)).toBe(false);
    expect(toggleSectionOpen(throwing, SECTION_ID, false)).toBe(true);
  });
});

describe("collapsible section view", () => {
  it("starts collapsed with the summary and an accessible header button", () => {
    const markup = renderSection();
    expect(markup).toContain('aria-controls="graphics.visualFeatures-content"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Visual features");
    expect(markup).toContain("— 10 of 10 on");
    expect(markup).toContain('class="settings-panel__collapsible-content" hidden=""');
  });

  it("shows the content without the summary when it was opened before", () => {
    vi.stubGlobal("localStorage", memoryStorage({ [getCollapseStorageKey(SECTION_ID)]: "1" }));
    const markup = renderSection();
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('class="settings-panel__collapsible-content" id=');
    expect(markup).toContain("Inner content");
    expect(markup).not.toContain("10 of 10 on");
  });
});
