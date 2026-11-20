import { type I18n, setupI18n } from "@lingui/core";
import { MAX_PLAYER_LEVEL } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { NATIONS } from "../../island-of-settlers-shared/src/nations";
import { defaultHomeScript } from "../../island-of-settlers-shared/src/script/books/index";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/index";
import { validateMapScript } from "../../island-of-settlers-shared/src/script/validate";
import { DAY_MS } from "../../island-of-settlers-shared/src/time/constants";
import { formatWareCount } from "../src/app/settlement-ui/helpers";
import { SETTLEMENT_MESSAGES } from "../src/app/settlement-ui/messages";
import { messages as german } from "../src/locales/de/messages";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import { TOOL_WARES } from "../src/render-common/wares/ware-catalog";
import { displayQuestText } from "../src/shared/i18n/quest-text";
import { translateMessage } from "../src/shared/i18n/translate";
import { type DailyQuest, generateDailyQuests } from "../src/shared/progression/daily-quests";
import { DAILY_QUEST_ID_PREFIX, DAILY_QUEST_TEXTS } from "../src/shared/quests/constants";
import { dailyQuestOf, isMaterializedDailyQuest, materializeDailyQuest } from "../src/shared/quests/daily-quest-book";

/**
 * QU3 daily parity: the generated global daily pool, materialized as unified quests, is the same quest on every
 * day of a year, for every player level and nation, with and without the relief (delivery) capability.
 */
const DAYS = 365;
const OTHER_NATION_DAY_STEP = 7;
const MISMATCH_SAMPLE = 3;
const FIRST_DAY_UTC = Date.UTC(2026, 0, 1);
const SEEDS = [1, 987654321];
const CAPABILITIES = [undefined, { reliefAvailable: true }] as const;
const MESSAGES = SETTLEMENT_MESSAGES.quests;
const book = defaultHomeScript().quests;

const dayKey = (index: number) => new Date(FIRST_DAY_UTC + index * DAY_MS).toISOString().slice(0, 10);
/** Every day × level for the Roman pool; the other nations (same pool, own drink wares) on every 7th day. */
const yearOfQuests = function* () {
  for (let day = 0; day < DAYS; day++) for (let level = 1; level <= MAX_PLAYER_LEVEL; level++)
    for (const [index, nation] of NATIONS.entries()) {
      if (index > 0 && (day + index) % OTHER_NATION_DAY_STEP !== 0) continue;
      for (const capabilities of CAPABILITIES)
        yield* generateDailyQuests(dayKey(day), level, SEEDS[day % SEEDS.length]!, TOOL_WARES, nation, capabilities);
    }
};
const sameReward = (first: DailyQuest["reward"], second: DailyQuest["reward"]) =>
  Object.keys(first).length === Object.keys(second).length &&
  Object.entries(first).every(([ware, amount]) => second[ware] === amount);
const sameQuest = (first: DailyQuest, second: DailyQuest) => first.id === second.id && first.kind === second.kind &&
  first.ware === second.ware && first.amount === second.amount && first.experience === second.experience &&
  first.done === second.done && first.progress === second.progress && sameReward(first.reward, second.reward);
const samples = (): DailyQuest[] => [1, 10, 20, 45].flatMap(level => NATIONS.flatMap(nation =>
  Array.from({ length: 40 }, (_, day) => generateDailyQuests(dayKey(day), level, 7, TOOL_WARES, nation,
    { reliefAvailable: true })).flat()));

describe("materialized daily quests", () => {
  it("are the generated quests of 365 days, every level and every nation", () => {
    let compared = 0;
    const kinds = new Set<string>();
    const mismatches: string[] = [];
    for (const generated of yearOfQuests()) {
      const quest = materializeDailyQuest(generated, book.dailyResetUtcMinutes);
      const restored: DailyQuest = { ...dailyQuestOf(quest), done: false, progress: 0 };
      if (!sameQuest(restored, generated) && mismatches.length < MISMATCH_SAMPLE) mismatches.push(generated.id);
      compared++;
      kinds.add(generated.kind);
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThanOrEqual(DAYS * MAX_PLAYER_LEVEL * CAPABILITIES.length);
    expect([...kinds].sort()).toEqual(["deliver", "produce"]);
  });

  it("keep the daily ledger id, repeat daily at the book's reset and pay the same rewards", () => {
    for (const generated of samples()) {
      const quest = materializeDailyQuest(generated, book.dailyResetUtcMinutes);
      expect(quest.id).toBe(`${DAILY_QUEST_ID_PREFIX}${generated.id}`);
      expect(isMaterializedDailyQuest(quest)).toBe(true);
      expect(quest.repeat).toEqual({ kind: "calendar", minuteUtc: book.dailyResetUtcMinutes, retryAfterFail: false });
      const { coins, goods, xp } = quest.homeReward!;
      expect(xp).toBe(generated.experience);
      expect({ coins, ...Object.fromEntries(goods.map(line => [line.ware, line.amount])) }).toEqual(generated.reward);
      const cost = generated.kind === "deliver" ? [{ amount: generated.amount, ware: generated.ware }] : [];
      expect(quest.cost).toEqual(cost);
      expect(quest.objective.kind).toBe(generated.kind === "deliver" ? "stockLevel" : "wareProduced");
    }
  });

  it("are Ready quests of a home map", () => {
    const quests = samples().map(quest => materializeDailyQuest(quest, book.dailyResetUtcMinutes));
    const unique = [...new Map(quests.map(quest => [quest.id, quest])).values()].slice(0, 150);
    const script: MapScript = { ...defaultHomeScript(), quests: { ...book, groups: [], quests: unique } };
    const result = validateMapScript(script, { languages: ["en", "hu", "de"], mapKind: "home" });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("materialized daily quest texts", () => {
  const locales: readonly I18n[] = [
    setupI18n({ locale: "en", messages: { en: english } }),
    setupI18n({ locale: "hu", messages: { hu: hungarian } }),
    setupI18n({ locale: "de", messages: { de: german } })
  ];

  it("use the quest window's existing Lingui ids and English", () => {
    const shipped = (message: { id: string; message?: string }) =>
      ({ en: message.message, translationKey: message.id });
    expect(DAILY_QUEST_TEXTS.deliver.title).toEqual(shipped(MESSAGES.deliver));
    expect(DAILY_QUEST_TEXTS.produce.title).toEqual(shipped(MESSAGES.produce));
    expect(DAILY_QUEST_TEXTS.deliver.goal).toEqual(shipped(MESSAGES.goalDeliver));
    expect(DAILY_QUEST_TEXTS.produce.goal).toEqual(shipped(MESSAGES.goalProduce));
  });

  it("show today's English title and goal, and the translated goal in hu and de", () => {
    for (const generated of samples()) {
      const quest = materializeDailyQuest(generated, book.dailyResetUtcMinutes);
      const titleMessage = generated.kind === "deliver" ? MESSAGES.deliver : MESSAGES.produce;
      const goalMessage = generated.kind === "deliver" ? MESSAGES.goalDeliver : MESSAGES.goalProduce;
      const wares = formatWareCount(generated.amount, generated.ware);
      expect(displayQuestText(quest.title!, locales[0])).toBe(translateMessage(locales[0], titleMessage, { wares }));
      for (const i18n of locales) expect(displayQuestText(quest.text!, i18n)).toBe(translateMessage(i18n, goalMessage));
    }
  });

  it("name the nation's own ware whether the quest stores it or the Roman pool ware", () => {
    const viking = { nation: "viking" };
    const [pool] = generateDailyQuests(dayKey(0), 45, 7, TOOL_WARES, "roman")
      .map(quest => ({ ...quest, ware: "wine" }));
    const quest = materializeDailyQuest(pool!, book.dailyResetUtcMinutes);
    const own = materializeDailyQuest({ ...pool!, ware: "mead" }, book.dailyResetUtcMinutes);
    expect(displayQuestText(quest.title!, locales[0], viking)).toBe(displayQuestText(own.title!, locales[0], viking));
  });
});
