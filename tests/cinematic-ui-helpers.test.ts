import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DIALOGUE_SPEED_MS_PER_CHAR
} from "../../island-of-settlers-shared/src/campaign/cinematics/constants";
import { speakDurationMs } from "../../island-of-settlers-shared/src/campaign/cinematics/speak-timing";
import type { CampaignSpeaker } from "../../island-of-settlers-shared/src/campaign/cinematics/types";
import {
  buildSpeakerPages, getInitials, getPageDurations, getSpeakerPanelView, resolveSpeakerPortrait, speakerPanelStateOf,
  type SpeakLine
} from "../src/app/campaign/cinematics/ui/helpers";
import { SpeakerPanel } from "../src/app/campaign/cinematics/ui/speaker-panel";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";

const SPEAKERS: CampaignSpeaker[] = [
  { id: "advisor", name: { en: "Aurelia Varro" }, portraits: { happy: "happy", neutral: "neutral", worried: "lost" } },
  { id: "captain", name: { en: "Captain Brannoc", hu: "Brannoc kapitány" }, portraits: { neutral: "c" }, side: "right" }
];
const IMAGES: Record<string, string> = { c: "/c.webp", happy: "/happy.webp", neutral: "/neutral.webp" };
const resolvePortrait = (id: string) => IMAGES[id] ?? null;
const LONG_HU = "A békés kereskedők nem rejtenek negyven fegyverest a fedélzet alatt. Hagyjuk őket kikötni, de a " +
  "katonáink a kikötőben maradnak, amíg meg nem tudjuk, mit akarnak valójában. Küldj futárt az őrtoronyhoz.";
const line = (id: string, speakerId: string, text: SpeakLine["text"], extra: Partial<SpeakLine> = {}) =>
  ({ delayMs: 0, id, kind: "speak", speakerId, start: "afterPrevious", text, timing: "auto", ...extra }) as SpeakLine;
const LINES = [
  line("a", "advisor", { en: "Sails on the horizon.", hu: "Vitorlák a láthatáron." }),
  line("b", "advisor", { en: "They are close.", hu: LONG_HU }, { expression: "happy" }),
  line("c", "captain", { en: "We come in peace." }, { waitForClick: true })
];
const pages = (language: string, msPerChar = DIALOGUE_SPEED_MS_PER_CHAR.normal) =>
  buildSpeakerPages({ language, lines: LINES, msPerChar, resolvePortrait, speakers: SPEAKERS });

describe("cinematic speaker panel helpers", () => {
  it("pages long lines per displayed language and times every page on its own", () => {
    const en = pages("en"), hu = pages("hu");
    expect(en).toHaveLength(3);
    expect(hu).toHaveLength(4);
    expect(hu.slice(1, 3).map(page => page.page?.short)).toEqual(["1 / 2", "2 / 2"]);
    expect(hu.slice(1, 3).every(page => Array.from(page.text).length <= 140)).toBe(true);
    expect(hu[1]!.text).toBe("A békés kereskedők nem rejtenek negyven fegyverest a fedélzet alatt.");
    expect(en[0]!.durationMs).toBe(2000 + 21 * 60);
    const huTotal = hu.slice(1, 3).reduce((sum, page) => sum + page.durationMs, 0);
    expect(huTotal).toBe(speakDurationMs(LINES[1]!, "hu"));
  });

  it("scales only the per-character time with the dialogue speed", () => {
    const text = "x".repeat(100), auto = line("t", "advisor", { en: text });
    expect(getPageDurations(auto, [text], DIALOGUE_SPEED_MS_PER_CHAR.slow)).toEqual([9500]);
    expect(getPageDurations(auto, [text], DIALOGUE_SPEED_MS_PER_CHAR.fast)).toEqual([6500]);
    const fixed = line("f", "advisor", { en: text }, { durationMs: 3001, timing: "fixed" });
    expect(getPageDurations(fixed, ["a", "b"], DIALOGUE_SPEED_MS_PER_CHAR.normal)).toEqual([1501, 1501]);
  });

  it("uses the English fallback names, sides and the neutral portrait fallback", () => {
    const hu = pages("hu");
    expect(hu.at(-1)).toMatchObject({ name: "Brannoc kapitány", portraitSource: "/c.webp", side: "right" });
    expect(hu[0]).toMatchObject({
      initials: "AV", name: "Aurelia Varro", portraitSource: "/neutral.webp", side: "left"
    });
    expect(hu[1]!.portraitSource).toBe("/happy.webp");
    expect(resolveSpeakerPortrait(SPEAKERS[0], "worried", resolvePortrait)).toBe("/neutral.webp");
    expect(resolveSpeakerPortrait(undefined, "neutral", resolvePortrait)).toBeNull();
    expect(getInitials("  Old   Tamsin the Keeper ")).toBe("OT");
  });

  it("slides the portrait in only when the speaker changes", () => {
    const keys = pages("hu").map(page => page.speakerKey);
    expect(new Set(keys.slice(0, 3)).size).toBe(1);
    expect(keys[3]).not.toBe(keys[2]);
    expect(new Set(pages("hu").map(page => page.key)).size).toBe(4);
  });

  it("maps the sequence player's shown page onto the panel pages", () => {
    const all = pages("hu");
    const lastLine = all.at(-1)!;
    expect(speakerPanelStateOf(all, { lineIndex: 0, pageIndex: 0, phase: "playing" })).toEqual({
      index: 0, phase: "playing"
    });
    expect(speakerPanelStateOf(all, { lineIndex: lastLine.lineIndex, pageIndex: 0, phase: "leaving" })).toEqual({
      index: all.length - 1, phase: "leaving"
    });
    expect(speakerPanelStateOf(all, { lineIndex: 9, pageIndex: 0, phase: "playing" })).toBeNull();
    expect(speakerPanelStateOf(all, null)).toBeNull();
  });

  it("hides the reading-time bar of a line that waits for a click", () => {
    const all = pages("en");
    expect(getSpeakerPanelView(all, { index: 0, phase: "playing" })).toMatchObject({ showTimer: true });
    expect(getSpeakerPanelView(all, { index: 2, phase: "playing" })).toMatchObject({ showTimer: false });
    expect(getSpeakerPanelView([], { index: 0, phase: "leaving" }).page).toBeNull();
    expect(getSpeakerPanelView(all, null).page).toBeNull();
  });

  it("renders English and Hungarian text and labels", () => {
    const i18n = setupI18n({ locale: "en", messages: { en: english, hu: { ...english, ...hungarian } } });
    const render = () => renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(SpeakerPanel, {
      lines: LINES, msPerChar: 60, onAdvance: () => undefined, resolvePortrait, speakers: SPEAKERS,
      speech: { lineIndex: 0, pageIndex: 0, phase: "playing" }
    })));
    expect(render()).toContain("Click or press Space to continue");
    expect(render()).toContain("Sails on the horizon.");
    i18n.activate("hu");
    expect(render()).toContain("Kattints, vagy nyomd meg a Szóközt a folytatáshoz");
    expect(render()).toContain("Vitorlák a láthatáron.");
    expect(render()).toContain('aria-label="Párbeszéd"');
  });
});
