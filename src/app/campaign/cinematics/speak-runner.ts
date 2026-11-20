/**
 * CIN3 speak step: pages a line in the displayed language and times every page on the sequence player's clock
 * (hidden tabs and held worlds pause it; no `setTimeout`). The speaker panel only renders the published page.
 */
import { resolveTranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { pageSpeakText } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/speak-timing";
import type { CinematicStepOf } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { CinematicRunContext, StepRunner } from "./run-context";
import { SPEAKER_PANEL_LEAVE_MS } from "./ui/constants";
import { getPageDurations } from "./ui/helpers";

export const createSpeakRunner = (step: CinematicStepOf<"speak">, context: CinematicRunContext): StepRunner => {
  const { presentation } = context;
  const pages = pageSpeakText(resolveTranslatableText(step.text, context.language));
  const durations = getPageDurations(step, pages, context.msPerChar);
  const scheduledMs = durations.reduce((total, duration) => total + duration, 0);
  const lineIndex = context.lineIndexOf(step.id);
  const waits = step.waitForClick === true;
  let startMs = 0, pageIndex = 0, pageStartMs = 0;
  let endedAtMs: number | null = null;

  const show = (phase: "leaving" | "playing") => presentation.setUi({ speech: { lineIndex, pageIndex, phase } });
  const hide = () => {
    if (presentation.ui.getSnapshot().speech?.lineIndex === lineIndex) presentation.setUi({ speech: null });
  };

  const end = (atMs: number) => {
    endedAtMs = atMs;
    show("leaving");
    const actualMs = atMs - startMs;
    if (waits || actualMs !== scheduledMs) context.reanchor(step.id, actualMs);
  };

  const nextPage = (atMs: number) => {
    if (pageIndex >= pages.length - 1) {
      end(atMs);
      return;
    }
    pageIndex++;
    pageStartMs = atMs;
    show("playing");
  };

  return {
    advance: nowMs => {
      if (endedAtMs === null) nextPage(nowMs);
    },
    begin: start => {
      startMs = pageStartMs = start;
      show("playing");
      // A click-only line holds every later step until it is clicked away.
      if (waits) context.reanchor(step.id, Number.POSITIVE_INFINITY);
    },
    finish: hide,
    settled: nowMs => endedAtMs !== null && nowMs >= endedAtMs + SPEAKER_PANEL_LEAVE_MS,
    update: nowMs => {
      if (endedAtMs !== null) {
        if (nowMs >= endedAtMs + SPEAKER_PANEL_LEAVE_MS) hide();
        return;
      }
      if (waits) return;
      // Several short pages may pass in one long frame; each starts where the previous one ended.
      for (let page = pageIndex; page < pages.length; page++) {
        const pageEndMs = pageStartMs + durations[pageIndex]!;
        if (endedAtMs !== null || nowMs < pageEndMs) return;
        nextPage(pageEndMs);
      }
    }
  };
};
