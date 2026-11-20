import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  MultiboardCellSnapshot, MultiboardRowSnapshot, MultiboardSnapshot
} from "../../island-of-settlers-shared/src/script/types/multiboards";
import {
  type BoardTextContext, collapseKey, createBoardViewCache, formatCell, formatCountdown, formatLocalCollapse,
  getBoardViews, isBoardCollapsed, parseLocalCollapse, phoneExpandedBoard, withLocalCollapse
} from "../src/app/script/multiboard/helpers";
import { MultiboardWindow } from "../src/app/script/multiboard/multiboard-window";

/** TRG8: multiboard view helpers (formatting, collapse rules, the identity cache) and the window markup. */

const context = (locale = "en"): BoardTextContext => ({
  collapseLabel: title => `Collapse ${title}`,
  expandLabel: title => `Expand ${title}`,
  iconUrl: contentId => `/icons/${contentId}.webp`,
  locale,
  text: text => (text[locale] as string | undefined) ?? text.en
});

const groveRow = (planted: number): MultiboardRowSnapshot => ({
  cells: [{ format: "text", value: { en: "Plant trees", hu: "Ültess fákat" } },
    { current: planted, format: "fraction", target: 8 }],
  icon: "tree:broadleafTree", id: "trees"
});

const board = (id: string, fields: Partial<MultiboardSnapshot> = {}): MultiboardSnapshot => ({
  collapsed: false, collapseRevision: 0,
  columns: [{ align: "left", header: { en: "Task", hu: "Feladat" }, id: "task", width: "auto" },
    { align: "right", header: { en: "Done", hu: "Kész" }, id: "done", width: 64 }],
  id, rows: [groveRow(3)], title: { en: "Grove project", hu: "Liget projekt" }, ...fields
});

const desktop: Parameters<typeof getBoardViews>[1] = { focusedId: null, phone: false, scope: "map", toggles: {} };

describe("multiboard cell formatting", () => {
  const format = (cell: MultiboardCellSnapshot, locale = "en") => formatCell(cell, context(locale));

  it("writes a fraction cell as current / target", () => {
    expect(format({ current: 3, format: "fraction", target: 8 })).toBe("3 / 8");
    expect(format({ current: 1250, format: "fraction", target: 2000 })).toBe("1,250 / 2,000");
  });

  it("formats numbers, percentages and countdowns for the locale", () => {
    expect(format({ format: "number", value: 1234.567 })).toBe("1,234.57");
    expect(format({ format: "iconNumber", value: 12 })).toBe("12");
    expect(format({ format: "percent", value: 75 })).toBe("75%");
    expect(format({ format: "countdown", value: 125 })).toBe("02:05");
    expect(format({ format: "number", value: 1234 }, "hu")).toMatch(/^1\s?234$/u);
  });

  it("counts down in whole seconds, with hours when needed and never below zero", () => {
    expect(formatCountdown(300)).toBe("05:00");
    expect(formatCountdown(299.95)).toBe("05:00");
    expect(formatCountdown(59.2)).toBe("01:00");
    expect(formatCountdown(0.35)).toBe("00:01");
    expect(formatCountdown(3725)).toBe("1:02:05");
    expect(formatCountdown(-4)).toBe("00:00");
  });

  it("resolves texts in the viewer's language and keeps array strings as written", () => {
    expect(format({ format: "text", value: { en: "Plant trees", hu: "Ültess fákat" } }, "hu")).toBe("Ültess fákat");
    expect(format({ format: "text", value: "Aurelia" })).toBe("Aurelia");
    expect(format({ format: "text", value: null })).toBe("");
    expect(format({ format: "text", value: true })).toBe("✓");
  });
});

describe("multiboard collapse rules", () => {
  it("lets the player's toggle win until the script collapses or expands the board again", () => {
    const shown = board("var-3");
    expect(isBoardCollapsed(shown, undefined)).toBe(false);
    expect(isBoardCollapsed(shown, { collapsed: true, revision: 0 })).toBe(true);
    const expandedByScript = board("var-3", { collapseRevision: 1 });
    expect(isBoardCollapsed(expandedByScript, { collapsed: true, revision: 0 })).toBe(false);
  });

  it("remembers toggles per map and board, newest last, within the limit", () => {
    let toggles = withLocalCollapse({}, collapseKey("map", "var-3"), { collapsed: true, revision: 0 });
    toggles = withLocalCollapse(toggles, collapseKey("map", "var-4"), { collapsed: true, revision: 2 });
    toggles = withLocalCollapse(toggles, collapseKey("map", "var-3"), { collapsed: false, revision: 0 });
    expect(Object.keys(toggles)).toEqual(["map/var-4", "map/var-3"]);
    expect(parseLocalCollapse(formatLocalCollapse(toggles))).toEqual(toggles);
    for (let index = 0; index < 80; index++) {
      toggles = withLocalCollapse(toggles, collapseKey("map", `b-${index}`), { collapsed: true, revision: 0 });
    }
    expect(Object.keys(toggles)).toHaveLength(64);
    expect(toggles["map/var-3"]).toBeUndefined();
  });

  it("reads unusable stored toggles as none", () => {
    expect(parseLocalCollapse(null)).toEqual({});
    expect(parseLocalCollapse("not json")).toEqual({});
    expect(parseLocalCollapse('{"a":{"collapsed":"yes","revision":0},"b":{"collapsed":true,"revision":1}}'))
      .toEqual({ b: { collapsed: true, revision: 1 } });
  });

  it("keeps one board expanded on a phone: the one opened last, else the first expanded one", () => {
    expect(phoneExpandedBoard(["a", "b"], null)).toBe("a");
    expect(phoneExpandedBoard(["a", "b"], "b")).toBe("b");
    expect(phoneExpandedBoard(["a"], "b")).toBe("a");
    expect(phoneExpandedBoard([], "b")).toBeNull();
    const boards = [board("a"), board("b"), board("c", { collapsed: true })];
    const viewOf = createBoardViewCache(context());
    const collapsedOn = (layout: Partial<typeof desktop>) =>
      getBoardViews(boards, { ...desktop, ...layout }, viewOf).map(view => view.collapsed);
    expect(collapsedOn({})).toEqual([false, false, true]);
    expect(collapsedOn({ phone: true })).toEqual([false, true, true]);
    expect(collapsedOn({ focusedId: "b", phone: true })).toEqual([true, false, true]);
    const toggles = { "map/a": { collapsed: true, revision: 0 } };
    expect(collapsedOn({ phone: true, toggles })).toEqual([true, false, true]);
  });
});

describe("multiboard view cache", () => {
  it("prepares the board: title, headers, widths, the row icon and the toggle", () => {
    const [view] = getBoardViews([board("var-3")], desktop, createBoardViewCache(context("hu")));
    expect(view).toMatchObject({
      className: "multiboard", expanded: true, hasHeaders: true, title: "Liget projekt", toggleIcon: "collapse",
      toggleLabel: "Collapse Liget projekt"
    });
    expect(view!.columns.map(column => [column.header, column.style])).toEqual([
      ["Feladat", undefined], ["Kész", { width: 64 }]]);
    expect(view!.rows[0]!.cells).toEqual([
      { className: "multiboard__cell multiboard__cell--left", icon: "/icons/tree:broadleafTree.webp", id: "task",
        text: "Ültess fákat" },
      { className: "multiboard__cell multiboard__cell--right multiboard__cell--numeric", icon: null, id: "done",
        text: "3 / 8" }
    ]);
  });

  it("puts the row icon into the icon-number column when the board has one", () => {
    const row: MultiboardRowSnapshot = {
      cells: [{ format: "text", value: "Logs" }, { format: "iconNumber", value: 40 }], icon: "ware:logs", id: "logs"
    };
    const [view] = getBoardViews([board("var-5", { rows: [row] })], desktop, createBoardViewCache(context()));
    expect(view!.rows[0]!.cells.map(cell => cell.icon)).toEqual([null, "/icons/ware:logs.webp"]);
  });

  it("returns the same view for an unchanged board and reuses unchanged rows of a changed one", () => {
    const viewOf = createBoardViewCache(context());
    const kept = groveRow(3);
    const first = board("var-3", { rows: [kept, { ...groveRow(1), id: "second" }] });
    const before = getBoardViews([first], desktop, viewOf)[0]!;
    expect(getBoardViews([first], desktop, viewOf)[0]).toBe(before);
    const changed = { ...first, rows: [kept, { ...groveRow(2), id: "second" }] };
    const after = getBoardViews([changed], desktop, viewOf)[0]!;
    expect(after).not.toBe(before);
    expect(after.rows[0]).toBe(before.rows[0]);
    expect(after.rows[1]!.cells[1]!.text).toBe("2 / 8");
  });
});

describe("MultiboardWindow", () => {
  const render = (snapshot: MultiboardSnapshot, toggles = {}) => {
    const [view] = getBoardViews([snapshot], { ...desktop, toggles }, createBoardViewCache(context()));
    return renderToStaticMarkup(createElement(MultiboardWindow, { board: view!, onToggle: () => undefined }));
  };

  it("shows the title on the left of the header, the collapse button on its right, then the table", () => {
    const markup = render(board("var-3"));
    expect(markup).toMatch(/<header class="multiboard__header"><h3[^>]*>Grove project<\/h3><button/u);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Collapse Grove project"');
    expect(markup).toContain('<th class="multiboard__heading multiboard__cell--right" scope="col">Done</th>');
    expect(markup).toContain("<span>3 / 8</span>");
    expect(markup).toContain('src="/icons/tree:broadleafTree.webp"');
  });

  it("keeps only the header of a collapsed board", () => {
    const markup = render(board("var-3"), { "map/var-3": { collapsed: true, revision: 0 } });
    expect(markup).toContain('class="multiboard multiboard--collapsed"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Expand Grove project"');
    expect(markup).not.toContain("<table");
  });
});
