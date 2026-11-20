import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { CreditsPanel } from "../src/app/settings/credits/credits-panel";
import { getCreditCategoryViews, getMusicLicenceLinks } from "../src/app/settings/credits/helpers";
import {
  CREDIT_CATEGORIES,
  GAME_CREATOR,
  getAttributionText,
  requiresAttribution
} from "../src/app/settings/credits-data";
import { renderWithI18n } from "./helpers/render-with-i18n";

// The mount helper reads the browser language store; markup checks need only the view.
vi.mock("../src/app/components/react-island", () => ({ mountReactIsland: vi.fn() }));

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")
  .replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const render = () => renderWithI18n(createElement(CreditsPanel, {
  categories: getCreditCategoryViews(), musicLinks: getMusicLicenceLinks()
}));
const entries = CREDIT_CATEGORIES.flatMap(category => category.entries);

describe("credits panel markup", () => {
  it("puts the creator first, then the music licences and every group heading in data order", () => {
    const markup = render();
    expect(markup).toMatch(/^<section aria-label="Creator" class="credits-window__creator">/);
    expect(markup).toContain(`<p class="credits-window__creator-name">${GAME_CREATOR.name}</p>`);
    let last = markup.indexOf('aria-label="Music and instrument licences"');
    expect(last).toBeGreaterThan(0);
    for (const category of CREDIT_CATEGORIES) {
      const heading = `<h3 class="credits-window__heading" id="credits-category-${category.id}">` +
        `${escape(category.title)}</h3>`;
      const index = markup.indexOf(heading);
      expect(index, category.id).toBeGreaterThan(last);
      expect(markup).toContain(`aria-labelledby="credits-category-${category.id}"`);
      last = index;
    }
  });

  it("renders one row per entry with its licence badge and CC BY attribution", () => {
    const markup = render();
    expect(markup.match(/<li class="credits-entry">/g)).toHaveLength(entries.length);
    for (const entry of entries) {
      expect(markup).toContain(`credits-entry__licence--${entry.licence}`);
      if (requiresAttribution(entry))
        expect(markup).toContain(`<p class="credits-entry__attribution">${escape(getAttributionText(entry))}</p>`);
    }
    expect(markup.match(/credits-entry__attribution/g)).toHaveLength(entries.filter(requiresAttribution).length);
  });

  it("opens every link in a new tab without opener and keeps linkless names as text", () => {
    const markup = render();
    const links = markup.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(20);
    for (const link of links) expect(link).toContain('rel="noopener noreferrer" target="_blank"');
    const withSource = entries.find(entry => entry.sourceUrl)!;
    expect(markup).toContain(`<a class="credits-entry__title" href="${escape(withSource.sourceUrl!)}"`);
    const withoutSource = entries.find(entry => !entry.sourceUrl)!;
    expect(markup).toContain(`<span class="credits-entry__title">${escape(withoutSource.title)}</span>`);
    expect(markup).toContain(">Music credits</a>");
    expect(markup).toContain(">Instrument licence</a>");
  });
});
