import type { I18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";

import type { ResolveCampaignImage } from "../../helpers";
import type { CinematicPresentation } from "../presentation";
import { SpeakerPanel } from "./speaker-panel";
import { useCinematicUi } from "./use-cinematic-ui";

import "./cinematics.css";

interface CinematicLayerProps {
  presentation: CinematicPresentation;
  resolvePortrait: ResolveCampaignImage;
  onAdvance: () => void;
  onSkipPress: () => void;
}

/**
 * CIN5 cinematic layer: letterbox bars and the fade (DOM, their amounts written per frame without a render), the
 * speaker panel and the skip button / "press again" prompt. Above the hidden HUD; identical on every detail level.
 */
export const CinematicLayer = ({ presentation, resolvePortrait, onAdvance, onSkipPress }: CinematicLayerProps) => {
  const { bottomRef, fadeRef, msPerChar, rootRef, skipLabel, topRef, ui } = useCinematicUi(presentation);
  return (
    <div aria-hidden={!ui.active} className="cinematic-layer" data-active={ui.active} data-fade={ui.fadeColor}
      ref={rootRef}>
      <div className="cinematic-layer__fade" ref={fadeRef} />
      <div className="cinematic-layer__bar cinematic-layer__bar--top" ref={topRef} />
      <div className="cinematic-layer__bar cinematic-layer__bar--bottom" ref={bottomRef} />
      <SpeakerPanel lines={ui.lines} msPerChar={msPerChar} resolvePortrait={resolvePortrait} speakers={ui.speakers}
        speech={ui.speech} onAdvance={onAdvance} />
      {ui.active && (
        <button className="cinematic-layer__skip" data-armed={ui.skipPrompt} data-cinematic-ui="" type="button"
          onClick={onSkipPress}>
          {skipLabel}
        </button>
      )}
    </div>
  );
};

export interface CinematicLayerMount extends Omit<CinematicLayerProps, "presentation"> {
  host: HTMLElement;
  i18n: I18n;
  presentation: CinematicPresentation;
}

export const mountCinematicLayer = ({ host, i18n, ...props }: CinematicLayerMount) => {
  const root = createRoot(host);
  root.render(<I18nProvider i18n={i18n}><CinematicLayer {...props} /></I18nProvider>);
  return () => root.unmount();
};
