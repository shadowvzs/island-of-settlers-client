import type { StoryClaim } from "../app/campaign/story-panel/types";
import { DEFAULT_REVIEW_PLANTED, MAX_REVIEW_COUNTDOWN_SECONDS, REVIEW_VIEWS } from "./constants";
import {
  epilogueContent, FIXTURE_ACTOR_LINES, FIXTURE_LINES, GRANTED_CLAIM, introContent, RICH_CLAIM
} from "./fixture-data";
import { GROVE_TARGET } from "./multiboard-fixture-data";
import type { MultiboardReviewOptions } from "./multiboard-review-session";

export type ReviewView = (typeof REVIEW_VIEWS)[number];
export type ReviewScene = "day" | "night" | "snow";

export interface ReviewOptions {
  hold: boolean;
  language: "en" | "hu";
  multiboard: MultiboardReviewOptions;
  scene: ReviewScene;
  theme: "dark" | "light";
  view: ReviewView;
}

const pick = <T extends string>(value: string | null, choices: readonly T[], fallback: T) =>
  choices.find(choice => choice === value) ?? fallback;

/** `planted=<0..8>` trees at the start; any other value reads as the default. */
const parsePlanted = (value: string | null) => {
  const planted = Number(value ?? Number.NaN);
  return Number.isInteger(planted) && planted >= 0 && planted <= GROVE_TARGET ? planted : DEFAULT_REVIEW_PLANTED;
};

/** `timer=<0..300>` script seconds already counted down; without it the review shows no timers. */
const parseCountdown = (value: string | null) => {
  const seconds = Number(value ?? Number.NaN);
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_REVIEW_COUNTDOWN_SECONDS ? seconds : null;
};

/**
 * `?view=…&lang=en|hu&theme=light|dark&scene=day|snow|night&hold=1` (hold: lines wait for a click); the multiboard
 * view also reads `planted=<0..8>&boards=2&timer=<0..300>`.
 */
export const parseReviewOptions = (search: string): ReviewOptions => {
  const params = new URLSearchParams(search);
  return {
    hold: params.get("hold") === "1",
    language: pick(params.get("lang"), ["en", "hu"], "en"),
    multiboard: {
      countdownSeconds: parseCountdown(params.get("timer")), planted: parsePlanted(params.get("planted")),
      secondBoard: params.get("boards") === "2"
    },
    scene: pick(params.get("scene"), ["day", "night", "snow"], "day"),
    theme: pick(params.get("theme"), ["dark", "light"], "light"),
    view: pick(params.get("view"), REVIEW_VIEWS, "intro")
  };
};

export const initialReviewClaim = (view: ReviewView): StoryClaim => {
  if (view === "epilogue-failure") return { status: "failed" };
  if (view === "epilogue-pending") return { status: "pending" };
  if (view === "epilogue-rewards") return RICH_CLAIM;
  return GRANTED_CLAIM;
};

const speakerViewLines = (view: ReviewView) => {
  if (view === "speaker-actor") return FIXTURE_ACTOR_LINES;
  if (view === "speaker-fallback") return FIXTURE_LINES.filter(line => line.speakerId === "keeper");
  return FIXTURE_LINES;
};

/**
 * The dialogue of a speaker view: the fallback view plays only the line of the speaker without a portrait, the
 * actor view the lines of the named script actors.
 */
export const reviewLines = (view: ReviewView, hold: boolean) => {
  const lines = speakerViewLines(view);
  if (!hold) return lines;
  return lines.map(line => ({ ...line, waitForClick: true }));
};

/** The story of a story view; the epilogue carries the review's current claim state. */
export const reviewStoryContent = (view: ReviewView, claim: StoryClaim) => {
  if (view.startsWith("intro")) return introContent(view === "intro-replay");
  return epilogueContent(claim);
};
