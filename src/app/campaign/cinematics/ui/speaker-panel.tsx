import type { PointerEvent } from "react";

import { CampaignImage } from "../../campaign-image/campaign-image";
import type { SpeakerPage, SpeakerPanelView as SpeakerPanelViewModel } from "./helpers";
import { type SpeakerPanelOptions, useSpeakerPanel } from "./use-speaker-panel";

import "./cinematics.css";

interface SpeakerTextBoxProps {
  hint: string;
  page: SpeakerPage;
  showTimer: boolean;
  timerStyle: SpeakerPanelViewModel["timerStyle"];
}
const SpeakerTextBox = ({ hint, page, showTimer, timerStyle }: SpeakerTextBoxProps) => (
  <div className="speaker-panel__box">
    <p className="speaker-panel__name">{page.name}</p>
    <p className="speaker-panel__text">{page.text}</p>
    <div className="speaker-panel__footer">
      {page.page && <span aria-label={page.page.label} className="speaker-panel__page">{page.page.short}</span>}
      <span className="speaker-panel__hint">{hint}</span>
    </div>
    {showTimer && <span aria-hidden="true" className="speaker-panel__timer" style={timerStyle} />}
  </div>
);

interface SpeakerPanelViewProps {
  view: SpeakerPanelViewModel;
  onAdvance: () => void;
  onKeepFocus: (event: PointerEvent) => void;
}
/**
 * Bottom-of-screen dialogue: the speaker portrait slides in on its side, the text box with the name plate sits
 * beside it. Plain DOM and CSS transitions only (no extra GPU pass), identical on every detail level.
 */
export const SpeakerPanelView = ({ view, onAdvance, onKeepFocus }: SpeakerPanelViewProps) => {
  if (!view.page) return null;
  return (
    <section aria-label={view.label} aria-live="polite" className="speaker-panel" data-cinematic-ui=""
      data-phase={view.phase}
      data-side={view.page.side}>
      <button aria-label={view.hint} className="speaker-panel__advance" tabIndex={-1} type="button"
        onClick={onAdvance} onPointerDown={onKeepFocus} />
      <div className="speaker-panel__portrait" data-expression={view.page.expression} key={view.page.speakerKey}>
        <CampaignImage className="speaker-panel__frame" source={view.page.portraitSource}>
          {view.page.initials}
        </CampaignImage>
      </div>
      <SpeakerTextBox hint={view.hint} key={view.page.key} page={view.page} showTimer={view.showTimer}
        timerStyle={view.timerStyle} />
    </section>
  );
};

interface SpeakerPanelProps extends SpeakerPanelOptions {
  onAdvance: () => void;
}

/** The cinematic speaker panel, driven by the sequence player (page, timing, advance). */
export const SpeakerPanel = ({ onAdvance, ...options }: SpeakerPanelProps) => {
  const { onKeepFocus, view } = useSpeakerPanel(options);
  return <SpeakerPanelView view={view} onAdvance={onAdvance} onKeepFocus={onKeepFocus} />;
};
