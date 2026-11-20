import { useLingui } from "@lingui/react";
import type { RefObject } from "react";

import { translateMessage } from "../../shared/i18n/translate";
import { LabelledButton } from "../components/labelled-button";
import { SettlementIcon } from "../components/settlement-icon";
import { MUSIC_MESSAGES } from "./messages";
import type {
  MusicModeView,
  MusicPlaybackView,
  MusicProgressView,
  MusicVolumeView
} from "./music-player-helpers";
import type { MusicPlayerActions } from "./use-music-player";

interface MusicIconButtonProps {
  disabled?: boolean;
  icon: string;
  label: string;
  pressed?: boolean;
  title?: string;
  onClick: () => void;
}
/** Square transport button; the label is its accessible name, the title may add state. */
const MusicIconButton = ({ disabled, icon, label, pressed, title, onClick }: MusicIconButtonProps) => (
  <LabelledButton
    className="music-player__icon-button"
    disabled={disabled}
    label={label}
    pressed={pressed}
    title={title}
    onClick={onClick}
  >
    <SettlementIcon name={icon} />
  </LabelledButton>
);

interface MusicProgressProps {
  progress: MusicProgressView;
  seekRef: RefObject<HTMLInputElement | null>;
  onScrub: (value: string) => void;
  onScrubEnd: () => void;
}
const MusicProgress = ({ progress, seekRef, onScrub, onScrubEnd }: MusicProgressProps) => {
  const { i18n } = useLingui();
  return (
    <div className="music-player__progress">
      <input
        aria-label={translateMessage(i18n, MUSIC_MESSAGES.progress.label)}
        aria-valuetext={progress.valueText}
        disabled={progress.disabled}
        max={progress.max}
        min={0}
        ref={seekRef}
        step={0.1}
        style={progress.style}
        type="range"
        value={progress.value}
        onBlur={onScrubEnd}
        onChange={event => onScrub(event.target.value)}
      />
      <span className="music-player__time">{progress.timeText}</span>
    </div>
  );
};

interface MusicTransportProps {
  actions: MusicPlayerActions;
  loop: MusicModeView;
  playback: MusicPlaybackView;
  repeat: MusicModeView;
  transportDisabled: boolean;
}
const MusicTransport = ({ actions, loop, playback, repeat, transportDisabled }: MusicTransportProps) => {
  const { i18n } = useLingui();
  return (
    <div className="music-player__transport">
      <MusicIconButton
        disabled={transportDisabled}
        icon="musicPrevious"
        label={translateMessage(i18n, MUSIC_MESSAGES.transport.previous)}
        onClick={actions.onPrevious}
      />
      <MusicIconButton
        disabled={transportDisabled}
        icon={playback.toggleIcon}
        label={playback.toggleLabel}
        onClick={actions.onTogglePlayback}
      />
      <MusicIconButton
        disabled={transportDisabled}
        icon="musicStop"
        label={translateMessage(i18n, MUSIC_MESSAGES.transport.stop)}
        onClick={actions.onStop}
      />
      <MusicIconButton
        disabled={transportDisabled}
        icon="musicNext"
        label={translateMessage(i18n, MUSIC_MESSAGES.transport.next)}
        onClick={actions.onNext}
      />
      <MusicIconButton
        icon="musicLoop"
        label={loop.label}
        pressed={loop.pressed}
        title={loop.title}
        onClick={actions.onLoop}
      />
      <MusicIconButton
        icon="musicRepeat"
        label={repeat.label}
        pressed={repeat.pressed}
        title={repeat.title}
        onClick={actions.onRepeat}
      />
    </div>
  );
};

interface MusicVolumeProps {
  muted: boolean;
  volume: number;
  volumeView: MusicVolumeView;
  onMute: () => void;
  onVolume: (value: string) => void;
}
const MusicVolume = ({ muted, volume, volumeView, onMute, onVolume }: MusicVolumeProps) => {
  const { i18n } = useLingui();
  return (
    <div className="music-player__volume">
      <MusicIconButton icon="sound" label={volumeView.muteLabel} pressed={muted} onClick={onMute} />
      <input
        aria-label={translateMessage(i18n, MUSIC_MESSAGES.volume.label)}
        aria-valuetext={volumeView.valueText}
        max={1}
        min={0}
        step={0.01}
        style={volumeView.style}
        type="range"
        value={volume}
        onChange={event => onVolume(event.target.value)}
      />
      <span>{volumeView.volumeText}</span>
    </div>
  );
};

export interface MusicDeckProps extends MusicTransportProps {
  muted: boolean;
  progress: MusicProgressView;
  seekRef: RefObject<HTMLInputElement | null>;
  volume: number;
  volumeView: MusicVolumeView;
  onScrub: (value: string) => void;
  onScrubEnd: () => void;
}
/** Seek bar, transport and volume; every value is prepared by `useMusicPlayer`. */
export const MusicDeck = (props: MusicDeckProps) => {
  const { i18n } = useLingui();
  return (
    <section aria-label={translateMessage(i18n, MUSIC_MESSAGES.controls.label)} className={props.playback.deckClassName}>
      <MusicProgress
        progress={props.progress}
        seekRef={props.seekRef}
        onScrub={props.onScrub}
        onScrubEnd={props.onScrubEnd}
      />
      <MusicTransport
        actions={props.actions}
        loop={props.loop}
        playback={props.playback}
        repeat={props.repeat}
        transportDisabled={props.transportDisabled}
      />
      <MusicVolume
        muted={props.muted}
        volume={props.volume}
        volumeView={props.volumeView}
        onMute={props.actions.onMute}
        onVolume={props.actions.onVolume}
      />
    </section>
  );
};
