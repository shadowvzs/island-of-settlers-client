import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = resolve(import.meta.dirname, "../src");
const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const PANEL_CLASS_PATTERN = /\.settings-panel(?![\w-])/;
const SHOWN_DISPLAY_PATTERN = /(^|;)\s*display\s*:(?!\s*none\b)/;

const cssFiles = () => readdirSync(SOURCE_DIRECTORY, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(".css"))
  .map(entry => resolve(entry.parentPath, entry.name));

/** The compound selector that picks the styled element (the part after the last combinator). */
const subjectOf = (selector: string) => selector.trim().split(/\s*[\s>+~]\s*/).at(-1) ?? "";

/** Selectors that give a corner panel itself a visible `display` without leaving `[hidden]` alone. */
const unguardedPanelDisplays = (file: string) => {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders: string[] = [];
  for (const [, selectorList, body] of css.matchAll(RULE_PATTERN)) {
    if (!SHOWN_DISPLAY_PATTERN.test(body!)) continue;
    for (const selector of selectorList!.split(",")) {
      const subject = subjectOf(selector);
      if (PANEL_CLASS_PATTERN.test(subject) && !subject.includes(":not([hidden])"))
        offenders.push(selector.trim());
    }
  }
  return offenders;
};

/**
 * SETTINGS-CLOSE-BUG (2026-11-09): `.settings-panel.settings-menu { display: flex }` lives in a lazily
 * loaded sheet, lands after `.settings-panel[hidden] { display: none }` with the same specificity
 * and kept the closed Settings panel on screen. A visible display must be scoped to `:not([hidden])`.
 */
describe("corner panel display rules", () => {
  it("scope every visible display of a .settings-panel to :not([hidden])", () => {
    const offenders = cssFiles().flatMap(file =>
      unguardedPanelDisplays(file).map(selector => `${file.slice(SOURCE_DIRECTORY.length + 1)}: ${selector}`));
    expect(offenders).toEqual([]);
  });
});
