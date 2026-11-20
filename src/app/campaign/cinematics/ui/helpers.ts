import type { I18n } from "@lingui/core";
import type { CSSProperties } from "react";

import { resolveTranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import {
  autoDurationMs, pageSpeakText
} from "../../../../../../island-of-settlers-shared/src/campaign/cinematics/speak-timing";
import type {
  CampaignSpeaker, CinematicSpeakerExpression, CinematicStepOf
} from "../../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { translateMessage } from "../../../../shared/i18n/translate";
import { getPageLabels, type PageLabels, type ResolveCampaignImage } from "../../helpers";
import { SPEAKER_INITIALS_MAX } from "./constants";
import { CINEMATIC_UI_MESSAGES as M } from "./messages";

export type SpeakLine = CinematicStepOf<"speak">;

/** One displayed page of a speak line: who speaks, the text and how long it stays. */
export interface SpeakerPage {
  durationMs: number;
  expression: CinematicSpeakerExpression;
  initials: string;
  /** Unique per page; a new key replays the text box's appear transition. */
  key: string;
  /** The line's index in the dialogue and the page's index in its line (the player's `CinematicSpeech`). */
  lineIndex: number;
  name: string;
  page: PageLabels;
  pageIndex: number;
  portraitSource: string | null;
  side: "left" | "right";
  /** Unique per speaker run: the portrait slides in only when the speaker changes. */
  speakerKey: string;
  text: string;
  waitForClick: boolean;
}

/** Up to two initials of a speaker name ("Aurelia Varro" → "AV") for the portrait fallback. */
export const getInitials = (name: string) => Array.from(name.trim().split(/\s+/u))
  .filter(Boolean)
  .slice(0, SPEAKER_INITIALS_MAX)
  .map(word => Array.from(word)[0]!.toLocaleUpperCase())
  .join("");

/**
 * The portrait of an expression; an expression without its own portrait, or whose image record is missing, falls
 * back to the required neutral portrait (and that to the initials medallion of the view).
 */
export const resolveSpeakerPortrait = (
  speaker: CampaignSpeaker | undefined, expression: CinematicSpeakerExpression, resolvePortrait: ResolveCampaignImage
) => {
  if (!speaker) return null;
  const expressionId = speaker.portraits[expression];
  const expressionSource = expressionId ? resolvePortrait(expressionId) : null;
  return expressionSource ?? resolvePortrait(speaker.portraits.neutral);
};

/**
 * Page durations of one line: `auto` gives every page its own reading time in the shown language (CIN1 section
 * 3.6, scaled by the dialogue speed); `fixed` spreads the authored duration evenly over the pages.
 */
export const getPageDurations = (line: SpeakLine, pages: readonly string[], msPerChar: number) => {
  if (line.timing === "auto") return pages.map(page => autoDurationMs(page, msPerChar));
  const share = Math.round((line.durationMs ?? 0) / Math.max(1, pages.length));
  return pages.map(() => share);
};

interface SpeakerPagesOptions {
  language: string;
  lines: readonly SpeakLine[];
  msPerChar: number;
  speakers: readonly CampaignSpeaker[];
  i18n?: I18n;
  resolvePortrait: ResolveCampaignImage;
}

const linePages = (line: SpeakLine, lineIndex: number, speakerRun: number, options: SpeakerPagesOptions) => {
  const { i18n, language, msPerChar, resolvePortrait, speakers } = options;
  const speaker = speakers.find(candidate => candidate.id === line.speakerId);
  const name = speaker ? resolveTranslatableText(speaker.name, language) : line.speakerId;
  const expression = line.expression ?? "neutral";
  const portraitSource = resolveSpeakerPortrait(speaker, expression, resolvePortrait);
  const texts = pageSpeakText(resolveTranslatableText(line.text, language));
  const durations = getPageDurations(line, texts, msPerChar);
  return texts.map((text, pageIndex): SpeakerPage => ({
    durationMs: durations[pageIndex]!,
    expression,
    initials: getInitials(name),
    key: `${lineIndex}:${line.id}:${pageIndex}`,
    lineIndex,
    name,
    page: getPageLabels(pageIndex, texts.length, i18n),
    pageIndex,
    portraitSource,
    side: speaker?.side ?? "left",
    speakerKey: `${speakerRun}:${line.speakerId}`,
    text,
    waitForClick: line.waitForClick ?? false
  }));
};

/** Every page of a dialogue in the displayed language (English fallback), lines paged above 140 characters. */
export const buildSpeakerPages = (options: SpeakerPagesOptions) => {
  let speakerRun = 0;
  return options.lines.flatMap((line, lineIndex) => {
    if (lineIndex > 0 && options.lines[lineIndex - 1]!.speakerId !== line.speakerId) speakerRun++;
    return linePages(line, lineIndex, speakerRun, options);
  });
};

export type SpeakerPanelPhase = "playing" | "leaving";
export interface SpeakerPanelState {
  index: number;
  phase: SpeakerPanelPhase;
}

/**
 * The panel state of the sequence player's shown page (`lineIndex`/`pageIndex`); null or an unknown page shows
 * nothing. The player owns the timing on its presentation clock.
 */
export const speakerPanelStateOf = (
  pages: readonly SpeakerPage[],
  speech: { lineIndex: number; pageIndex: number; phase: SpeakerPanelPhase } | null
): SpeakerPanelState | null => {
  if (!speech) return null;
  const index = pages.findIndex(page => page.lineIndex === speech.lineIndex && page.pageIndex === speech.pageIndex);
  return index < 0 ? null : { index, phase: speech.phase };
};

/** The current page plus the labels and the reading-time bar of the view. */
export const getSpeakerPanelView = (pages: readonly SpeakerPage[], state: SpeakerPanelState | null, i18n?: I18n) => {
  const page = state ? pages[Math.min(state.index, pages.length - 1)] ?? null : null;
  return {
    hint: translateMessage(i18n, M.advanceHint),
    label: translateMessage(i18n, M.dialogue),
    page,
    phase: state?.phase ?? "leaving",
    showTimer: Boolean(page && !page.waitForClick),
    timerStyle: { "--speaker-page-ms": `${page?.durationMs ?? 0}ms` } as CSSProperties
  };
};

export type SpeakerPanelView = ReturnType<typeof getSpeakerPanelView>;
