import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DeveloperDiaryPanel } from "../src/app/settings/developer-diary/developer-diary-panel";
import { formatDiaryDate, getDiaryEntryViews } from "../src/app/settings/developer-diary/helpers";
import { DEVELOPER_DIARY } from "../src/app/settings/developer-diary-data";
import { renderWithI18n } from "./helpers/render-with-i18n";

// The mount helper reads the browser language store; markup checks need only the view.
vi.mock("../src/app/components/react-island", () => ({ mountReactIsland: vi.fn() }));

const render = () => renderWithI18n(createElement(DeveloperDiaryPanel, { entries: getDiaryEntryViews() }));

describe("Game News panel markup", () => {
  it("starts with the intro, then one dated article per entry, newest first", () => {
    const markup = render();
    expect(markup).toMatch(/^<p class="developer-diary__intro">A little journal/);
    expect(markup.match(/<article>/g)).toHaveLength(DEVELOPER_DIARY.length);
    let last = 0;
    for (const entry of DEVELOPER_DIARY) {
      const time = `<time dateTime="${entry.date}">${formatDiaryDate(entry.date)}</time>`;
      const index = markup.indexOf(time);
      expect(index, entry.date).toBeGreaterThan(last);
      expect(markup.indexOf(`<h3>${entry.title}</h3>`)).toBeGreaterThan(index);
      last = index;
    }
  });

  it("lists every change of every entry", () => {
    const markup = render();
    const changes = DEVELOPER_DIARY.flatMap(entry => entry.changes);
    expect(markup.match(/<li>/g)).toHaveLength(changes.length);
    expect(markup).toContain("then a builder comes over with a hammer.");
  });

  it("formats the day the same in every time zone", () => {
    expect(formatDiaryDate("2026-10-15")).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: "long" })
      .format(new Date(2026, 9, 15)));
  });
});
