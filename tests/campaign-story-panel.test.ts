import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getClaimView, getStoryActionResult, getStoryActions, getStoryPanelView, toParagraphs
} from "../src/app/campaign/story-panel/helpers";
import { StoryPanel } from "../src/app/campaign/story-panel/story-panel";
import type { StoryPanelContent } from "../src/app/campaign/story-panel/types";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";

const i18n = setupI18n({ locale: "en", messages: { en: english, hu: { ...english, ...hungarian } } });
const page = (title: string, imageId: string | null = null) =>
  ({ imageId, text: { en: `${title} text.\n\nSecond paragraph.`, hu: `${title} szöveg.` }, title: { en: title } });
const intro = (replay = false): StoryPanelContent =>
  ({ kind: "intro", pages: [page("One", "image-1"), page("Two")], replay });
const rewards = {
  coins: 100, decorations: [{ amount: 2, item: "roadDecoration:roman-rusticated-arch:limestone" },
    { amount: 1, item: "roadDecoration:japanese-stone-lantern:granite" }], gems: 3,
  goods: [{ amount: 12, ware: "planks" }, { amount: 0, ware: "bread" }], xp: 250
};
const epilogue = (claim: StoryPanelContent["claim"]): StoryPanelContent =>
  ({ claim, kind: "epilogue", outcome: "victory", pages: [page("Intro"), page("End")], replay: true });
const resolveImage = (imageId: string) => (imageId === "image-1" ? "/image-1.webp" : null);
const ids = (content: StoryPanelContent, index: number) => getStoryActions(content, index).map(action => action.id);

describe("campaign story panel helpers", () => {
  it("keeps the author's lines as paragraphs and drops blank lines", () => {
    expect(toParagraphs("  First.\n\n  Second.  \n")).toEqual(["First.", "Second."]);
  });

  it("pages forward, closes the intro and skips only on replays before the last page", () => {
    expect(ids(intro(), 0)).toEqual(["next"]);
    expect(ids(intro(true), 0)).toEqual(["next", "skip"]);
    expect(ids(intro(true), 1)).toEqual(["begin"]);
    expect(getStoryActionResult("next", intro(), 0)).toEqual({ index: 1, kind: "page" });
    expect(getStoryActionResult("skip", intro(true), 0)).toEqual({ kind: "close" });
    expect(getStoryActionResult("begin", intro(), 1)).toEqual({ kind: "close" });
  });

  it("skips an epilogue to its last page, so the claim result stays visible", () => {
    const content = epilogue({ rewards, status: "granted" });
    expect(getStoryActionResult("skip", content, 0)).toEqual({ index: 1, kind: "page" });
    expect(getStoryPanelView({ content, language: "en", pageIndex: 0, resolveImage }).claim).toBeNull();
    expect(getStoryPanelView({ content, language: "en", pageIndex: 1, resolveImage }).claim?.status).toBe("granted");
  });

  // Owner decision 2026-11-13: Skip keeps this behaviour (intro closes, epilogue lands on its claim page).
  it("never closes an epilogue on Skip, whatever its claim state or page, and offers no Skip on the claim page", () => {
    const claims: StoryPanelContent["claim"][] = [{ status: "failed" }, { rewards, status: "granted" },
      { status: "pending" }];
    for (const claim of claims) {
      const content: StoryPanelContent = { ...epilogue(claim), pages: [page("One"), page("Two"), page("End")] };
      expect(getStoryActionResult("skip", content, 0)).toEqual({ index: 2, kind: "page" });
      expect(getStoryActionResult("skip", content, 1)).toEqual({ index: 2, kind: "page" });
      expect(ids(content, 1)).toContain("skip");
      expect(ids(content, 2)).not.toContain("skip");
    }
  });

  it("offers Retry first and Later on a failed claim, and waits on a pending one", () => {
    expect(ids(epilogue({ status: "failed" }), 1)).toEqual(["retry", "later"]);
    expect(getStoryActionResult("retry", epilogue({ status: "failed" }), 1)).toEqual({ kind: "retry" });
    expect(getStoryActionResult("later", epilogue({ status: "failed" }), 1)).toEqual({ kind: "close" });
    const [pending] = getStoryActions(epilogue({ status: "pending" }), 1);
    expect(pending).toMatchObject({ disabled: true, id: "continue" });
  });

  it("shows the granted rewards only, never a forecast", () => {
    const granted = getClaimView({ rewards, status: "granted" }).rewards!;
    expect(granted.items.map(item => item.key)).toEqual(["coins", "gems", "ware:planks",
      "decoration:roadDecoration:roman-rusticated-arch:limestone",
      "decoration:roadDecoration:japanese-stone-lantern:granite"]);
    expect(granted.items.at(-1)?.icon).toEqual({ kind: "image",
      source: expect.stringContaining("icons/road-decorations/japanese-stone-lantern-granite.png") });
    expect(granted.experience?.text).toBe("+250 XP");
    expect(getClaimView({ status: "failed" }).rewards).toBeNull();
    expect(getClaimView({ status: "pending" }).rewards).toBeNull();
  });

  it("resolves the displayed language with the English fallback and the image through the owner", () => {
    const view = getStoryPanelView({ content: intro(), language: "hu", pageIndex: 0, resolveImage });
    expect(view.title).toBe("One");
    expect(view.paragraphs).toEqual(["One szöveg."]);
    expect(view).toMatchObject({ hasImage: true, imageSource: "/image-1.webp", page: { short: "1 / 2" } });
    const second = getStoryPanelView({ content: intro(), language: "de", pageIndex: 1, resolveImage });
    expect(second).toMatchObject({
      hasImage: false, page: { short: "2 / 2" }, paragraphs: ["Two text.", "Second paragraph."]
    });
  });

  it("renders English and Hungarian labels", () => {
    const render = () => renderToStaticMarkup(createElement(I18nProvider, { i18n },
      createElement(StoryPanel, {
        content: epilogue({ status: "failed" }), onClose: () => undefined, onRetryClaim: () => undefined, resolveImage
      })));
    i18n.activate("en");
    expect(render()).toContain("Epilogue · Victory");
    expect(render()).toContain(">Next<");
    expect(render()).toContain(">Skip<");
    i18n.activate("hu");
    const markup = render();
    expect(markup).toContain("Epilógus · Győzelem");
    expect(markup).toContain(">Következő<");
    expect(markup).toContain(">Kihagyás<");
    expect(markup).toContain("Intro szöveg.");
  });
});
