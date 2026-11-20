import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import {
  completeQuest, getQuestConfirming, getQuestDetails, getQuestTabs, isSameQuestBook, resolveQuestSelection,
  selectQuestBook, skipTutorialQuest
} from "../src/app/settlement-ui/quests/helpers";
import { createOpenRequest } from "../src/app/settlement-ui/open-request";
import { QuestBook } from "../src/app/settlement-ui/quests/quest-book";
import { QuestDetailPane } from "../src/app/settlement-ui/quests/quest-details";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import type { SettlementPlayerSummary, SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import type { DailyQuest } from "../src/shared/progression/daily-quests";
import { HOME_TUTORIAL_QUESTS as TUTORIAL_QUESTS } from "../src/shared/quests/home-quest-book";
import type { TutorialSummary } from "../src/shared/quests/home-quests";
import { renderWithI18n } from "./helpers/render-with-i18n";

const visible = () => createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true });
const storeWith = (snapshot: SettlementUiSnapshot) => {
  const store = createSettlementUiStore();
  store.update(snapshot);
  return store;
};
const quest = (fields: Partial<DailyQuest> & Pick<DailyQuest, "id">): DailyQuest =>
  ({ amount: 10, done: false, experience: 40, kind: "deliver", progress: 0, reward: { coins: 20, hardwoodPlanks: 4 }, ware: "logs", ...fields });
const optionalStep = TUTORIAL_QUESTS.find(step => step.optional && step.objective.kind === "build")!;
const tutorial = (fields: Partial<TutorialSummary> = {}): TutorialSummary =>
  ({ enabled: true, hasNew: false, next: null, progress: 0, quest: optionalStep, ready: false, skippable: true,
    ...fields });
const player = (fields: Partial<SettlementPlayerSummary>) =>
  ({ nation: "roman", quests: [], stock: {}, ...fields }) as SettlementPlayerSummary;
const daily = [quest({ id: "q1" }), quest({ id: "q2", kind: "produce", progress: 10, ware: "fish" }),
  quest({ done: true, id: "q3" })];

describe("quest book", () => {
  it("lists open quests with their stock and ignores a rebuilt summary with the same values", () => {
    const book = selectQuestBook({ player: player({ quests: daily, stock: { logs: 4 }, tutorial: tutorial() }) });
    expect(book.quests.map(entry => entry.id)).toEqual(["q1", "q2"]);
    expect(book.stored).toEqual([4, 0]);
    const again = selectQuestBook({ player: player({ quests: daily, stock: { logs: 4 }, tutorial: tutorial() }) });
    expect(isSameQuestBook(book, again)).toBe(true);
    const stocked = selectQuestBook({ player: player({ quests: daily, stock: { logs: 5 }, tutorial: tutorial() }) });
    expect(isSameQuestBook(book, stocked)).toBe(false);
    expect(isSameQuestBook(book, { ...again, tutorial: tutorial({ progress: 1 }) })).toBe(false);
    expect(selectQuestBook({}).loaded).toBe(false);
  });

  it("opens on the first quest and replaces a claimed one within its category", () => {
    const withTutorial = selectQuestBook({ player: player({ quests: daily, tutorial: tutorial() }) });
    expect(resolveQuestSelection(withTutorial, { id: "" })).toEqual({ category: "tutorial", id: optionalStep.id });
    const next = TUTORIAL_QUESTS[TUTORIAL_QUESTS.indexOf(optionalStep) + 1]!;
    const advanced = selectQuestBook({ player: player({ quests: daily, tutorial: tutorial({ quest: next }) }) });
    expect(resolveQuestSelection(advanced, { category: "tutorial", id: optionalStep.id }).id).toBe(next.id);
    const claimed = selectQuestBook({ player: player({ quests: daily.slice(1), tutorial: tutorial() }) });
    expect(resolveQuestSelection(claimed, { category: "daily", id: "q1" })).toEqual({ category: "daily", id: "q2" });
    const allDone = selectQuestBook({ player: player({ quests: [], tutorial: tutorial() }) });
    expect(resolveQuestSelection(allDone, { category: "daily", id: "q2" }).category).toBe("tutorial");
    expect(resolveQuestSelection(selectQuestBook({ player: player({}) }), { id: "" }))
      .toEqual({ category: "daily", id: "" });
  });

  it("orders the tutorial tab first with a roving tab index, ready highlight and vertical arrows", () => {
    const book = selectQuestBook({ player: player({ quests: daily, stock: { logs: 10 }, tutorial: tutorial() }) });
    const tabs = getQuestTabs(book, "q2");
    expect(tabs.all.map(tab => [tab.id, tab.index, tab.tabIndex])).toEqual([[optionalStep.id, 0, -1], ["q1", 1, -1],
      ["q2", 2, 0]]);
    expect(tabs.daily.map(tab => tab.className))
      .toEqual(Array(2).fill("settlement-ui__tab quest-window__entry is-ready"));
    expect(tabs.tutorial).toMatchObject({ icon: { building: 27 }, progressText: "0 / 1" });
    expect(tabs.selectedTabId).toBe("quest-window-tab-q2");
  });

  it("shows the talents star and the trade office balance on the feature tours", () => {
    const tours = [["talent.apply", /level-star/, "Learn a talent"], ["sea.trade-offer", /market/,
      "Place a trade offer"]] as const;
    for (const [id, image, title] of tours) {
      const step = TUTORIAL_QUESTS.find(entry => entry.id === id)!;
      const book = selectQuestBook({ player: player({ tutorial: tutorial({ quest: step }) }) });
      expect(getQuestTabs(book, id).tutorial).toMatchObject({ icon: { image: expect.stringMatching(image) },
        progressText: "0 / 1", title });
    }
  });

  it("prepares daily, tutorial and all-done details", () => {
    const book = selectQuestBook({ player: player({ quests: daily, stock: { logs: 4 }, tutorial: tutorial() }) });
    expect(getQuestDetails(book, "q1")).toMatchObject({ claimDisabled: true, claimLabel: "Deliver", percent: "40%",
      progressText: "4 / 10 in storage" });
    expect(getQuestDetails(book, "q1")).toMatchObject({ rewards: { experience: { text: "+40 XP" } } });
    expect(getQuestDetails(book, "q2")).toMatchObject({ claimDisabled: false, claimLabel: "Claim", percent: "100%" });
    expect(getQuestDetails(book, "q2", "q2"), "a claim waiting for the server").toMatchObject({
      claimDisabled: true, claimLabel: getQuestConfirming()
    });
    expect(getQuestDetails(book, "q2", "q1")).toMatchObject({ claimDisabled: false });
    expect(getQuestDetails(book, optionalStep.id)).toMatchObject({ claimDisabled: true, confirming: false,
      showDisabled: false, showHomeNote: false, skippable: true });
    expect(getQuestDetails(book, optionalStep.id, optionalStep.id), "a tutorial claim in flight")
      .toMatchObject({ claimDisabled: true, confirming: true });
    expect(getQuestDetails(selectQuestBook({ player: player({}) }), "")).toEqual({ kind: "done" });
  });

  it("shows the chapter, its reward and why a resource step may be skipped", () => {
    const meat = TUTORIAL_QUESTS.find(step => step.id === "food.meat")!;
    const book = selectQuestBook({ player: player({ tutorial: tutorial({ quest: meat, skippable: true }) }) });
    expect(getQuestDetails(book, meat.id)).toMatchObject({
      chapter: { chapter: "Chapter 4 of 30 · Fields and hunting", step: "Step 2 of 5" },
      chapterReward: "Completing this chapter reaches level 5 and unlocks Mill, Flax Farm.",
      showMissingNote: true, skipLabel: "Skip: not on this island", skippable: true
    });
    const optionalBook = selectQuestBook({ player: player({ tutorial: tutorial() }) });
    expect(getQuestDetails(optionalBook, optionalStep.id)).toMatchObject({ showMissingNote: false,
      skipLabel: "Skip optional quest" });
  });

  it("forwards claims and skips with their synchronous result", () => {
    const options = { onCompleteQuest: vi.fn(() => true as const), onSkipTutorial: vi.fn(() => "Not now") };
    expect(completeQuest(options, "q1")).toBe(true);
    expect(skipTutorialQuest(options, "t1")).toBe("Not now");
    expect(completeQuest({}, "q1")).toBe("");
  });

  it("renders the pending server claim on the disabled button itself", () => {
    const book = selectQuestBook({ player: player({ quests: daily, stock: { logs: 10 }, tutorial: tutorial() }) });
    const markup = renderWithI18n(createElement(QuestDetailPane, {
      details: getQuestDetails(book, "q2", "q2"),
      onClaim: () => {}, onShow: () => {}, onSkip: () => {}
    }));
    expect(markup).toContain(`aria-label="${getQuestConfirming()}"`);
    expect(markup).toContain(`<span>${getQuestConfirming()}</span>`);
    expect(markup).toMatch(/aria-label="Confirming with the server…" class="settlement-ui__button" disabled=""/);
  });

  it("renders tabs with data-quest-id and the claim row the drivers use", () => {
    const markup = renderWithI18n(createElement(QuestBook, {
      options: {}, request: createOpenRequest(),
      store: storeWith({ player: player({ quests: daily, stock: { logs: 4 }, tutorial: tutorial() }) }),
      visibility: visible()
    }));
    expect(markup).toContain('<div aria-label="Open quests" aria-orientation="vertical" class="quest-window__list" '
      + 'role="tablist"><strong class="quest-window__section">Tutorial</strong>');
    expect(markup).toContain(`aria-selected="true" class="settlement-ui__tab quest-window__entry" `
      + `data-quest-id="${optionalStep.id}"`);
    expect(markup).toContain('data-quest-id="q2"');
    expect(markup).toContain('<div class="quest-window__claim"><div aria-label="Rewards" '
      + 'class="reward-icons reward-icons--compact" role="group"><span class="reward-icons__experience"><img alt=""');
    expect(markup).toMatch(/aria-label="Claim" class="settlement-ui__button" disabled="" title="Claim"/);
    expect(markup).toContain('aria-label="Skip optional quest"');
    expect(markup).toContain('<small class="quest-window__status" role="status"></small>');
    expect(markup).toMatch(/Daily quest<small aria-label="A new daily quest arrives in \d+h \d+m\."/);
    expect(markup).toMatch(/class="quest-window__countdown" title="[^"]+">\(\d+h \d+m\)<\/small>/);
    expect(markup).not.toContain("quest-window__footer");
    expect(markup).not.toContain("Quest completed!");
  });

  it("keeps the daily countdown after completion and stays empty before the first summary", () => {
    const done = renderWithI18n(createElement(QuestBook, {
      options: {}, request: createOpenRequest(), store: storeWith({ player: player({}) }), visibility: visible()
    }));
    expect(done).toContain('class="quest-window__list"><strong class="quest-window__section">Daily quest');
    expect(done).toMatch(/quest-window__countdown" title="Next daily quest in \d+h \d+m\."/);
    expect(done).not.toContain('role="tablist"');
    expect(done).toContain("daily quest is complete. Well done!");
    expect(renderWithI18n(createElement(QuestBook,
      { options: {}, request: createOpenRequest(), store: storeWith({}), visibility: visible() })))
      .toBe("");
    const dailyOnly = renderWithI18n(createElement(QuestBook, {
      options: {}, request: createOpenRequest(), store: storeWith({ player: player({ quests: daily }) }),
      visibility: visible()
    }));
    expect(dailyOnly).not.toContain(">Tutorial</strong>");
    expect(dailyOnly).toContain('role="tablist"><strong class="quest-window__section">Daily quest<small');
  });
});

describe("quest rewards with talents", () => {
  it("shows the daily quest experience and goods raised by the quest reward talent", () => {
    const plain = selectQuestBook({ player: player({ quests: daily }) });
    const boosted = selectQuestBook({ player: player({ quests: daily, talents: { questRewards: 5 } }) });
    expect(getQuestDetails(plain, "q1")).toMatchObject({ rewards: { experience: { text: "+40 XP" }, items: [
      { count: "+20", key: "coins" }, { count: "+4", key: "ware:hardwoodPlanks" }] } });
    expect(getQuestDetails(boosted, "q1")).toMatchObject({ rewards: { experience: { text: "+50 XP" }, items: [
      { count: "+25", key: "coins" }, { count: "+5", key: "ware:hardwoodPlanks" }] } });
    expect(isSameQuestBook(plain, boosted)).toBe(false);
  });
  it("tells when the next daily quest arrives", () => {
    expect(selectQuestBook({ player: player({ quests: daily }) }).renewText)
      .toMatch(/^A new daily quest arrives in \d+h \d+m\.$/);
    expect(selectQuestBook({ player: player({}) }).renewText).toMatch(/^Next daily quest in \d+h \d+m\.$/);
  });
  it("counts down to the next UTC midnight of the game clock", () => {
    const gameTime = Date.UTC(2026, 9, 12, 22, 30);
    expect(selectQuestBook({ player: player({ gameTime }) }).renewCountdown).toBe("1h 30m");
    expect(selectQuestBook({ player: player({ gameTime }) }).renewText).toBe("Next daily quest in 1h 30m.");
  });
});
