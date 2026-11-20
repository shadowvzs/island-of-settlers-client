import { useLingui } from "@lingui/react";
import { useEffect, useMemo } from "react";

import type { CampaignSpeaker } from "../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { MS_PER_SECOND } from "../app/campaign/cinematics/constants";
import type { CinematicPlayerPorts } from "../app/campaign/cinematics/ports";
import type { CinematicSpeakLine } from "../app/campaign/cinematics/presentation";
import { createSequencePlayer } from "../app/campaign/cinematics/sequence-player";
import { useExternalStore } from "../app/components/external-store";
import { dialogueMsPerChar, dialogueSpeedPreference } from "../app/settings/dialogue-speed/preference";
import { REVIEW_ADVANCE_CODES } from "./constants";

const NO_OP = () => undefined;

const reviewPorts = (language: () => string): CinematicPlayerPorts => ({
  effects: { strikeLightning: NO_OP },
  language,
  mode: { enter: NO_OP, exit: NO_OP },
  msPerChar: () => dialogueMsPerChar(dialogueSpeedPreference.getSnapshot()),
  view: { cellsX: 1, cellsZ: 1, drawnOrbit: () => null, groundHeight: () => 0 },
  world: { applyStep: NO_OP, endSequence: NO_OP }
});

/**
 * The review page plays its dialogue through the real sequence player (the same clock and paging as in game),
 * advanced by animation frames; Space / Enter advance like the in-game input lock.
 */
export const useReviewDialogue = (lines: readonly CinematicSpeakLine[], speakers: readonly CampaignSpeaker[],
  run: number) => {
  const { i18n } = useLingui();
  const player = useMemo(() => createSequencePlayer(reviewPorts(() => i18n.locale)), [i18n]);
  const ui = useExternalStore(player.presentation.ui);
  useEffect(() => {
    player.play({ id: `review-${run}`, name: "Review", pauseWorld: false, skippable: true, steps: [...lines] },
      { regions: [], shots: [], speakers });
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      player.update((now - last) / MS_PER_SECOND);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!REVIEW_ADVANCE_CODES.has(event.code) || event.repeat) return;
      event.preventDefault();
      player.advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      player.clear();
    };
  }, [lines, player, run, speakers]);
  return { finished: ui.lines.length === 0, onAdvance: () => { player.advance(); }, ui };
};
