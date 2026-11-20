import { useLingui } from "@lingui/react";
import { type PointerEvent, useMemo } from "react";

import type { CampaignSpeaker } from "../../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { ResolveCampaignImage } from "../../helpers";
import type { CinematicSpeech } from "../presentation";
import { buildSpeakerPages, getSpeakerPanelView, speakerPanelStateOf, type SpeakLine } from "./helpers";

export interface SpeakerPanelOptions {
  /** The speak lines of the playing sequence, in order (the player's `CinematicUiState.lines`). */
  lines: readonly SpeakLine[];
  /** Reading time per character of the player's dialogue speed (`useDialogueMsPerChar`). */
  msPerChar: number;
  /** The page the sequence player shows (it times every page on its presentation clock). */
  speech: CinematicSpeech | null;
  speakers: readonly CampaignSpeaker[];
  resolvePortrait: ResolveCampaignImage;
}

/** The advance surface never takes focus, so Space / Enter reach only the cinematic input lock. */
const onKeepFocus = (event: PointerEvent) => event.preventDefault();

/** The view of the sequence player's shown speak page in the displayed language. */
export const useSpeakerPanel = ({ lines, msPerChar, resolvePortrait, speakers, speech }: SpeakerPanelOptions) => {
  const { i18n } = useLingui();
  const language = i18n.locale;
  const pages = useMemo(() => buildSpeakerPages({ i18n, language, lines, msPerChar, resolvePortrait, speakers }),
    [i18n, language, lines, msPerChar, resolvePortrait, speakers]);
  const view = getSpeakerPanelView(pages, speakerPanelStateOf(pages, speech), i18n);
  return { onKeepFocus, view };
};
