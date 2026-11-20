import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { memo } from "react";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { translateMessage } from "../../shared/i18n/translate";
import { mountReactIsland } from "../components/react-island";
import { SettlementIcon } from "../components/settlement-icon";
import { MUSIC_MESSAGES } from "./messages";
import { MUSIC_COLLECTIONS } from "./music-catalog";
import { MusicDeck, type MusicDeckProps } from "./music-player-deck";
import type { MusicPlaylistOption } from "./music-player-helpers";
import { createBrowserMusicPlayer, type MusicPlayerService } from "./music-player-service";
import { useMusicPlayer } from "./use-music-player";

interface MusicCollectionSelectProps {
  collection: string;
  onSelectCollection: (value: string) => void;
}
const MusicCollectionSelect = memo(({ collection, onSelectCollection }: MusicCollectionSelectProps) => {
  const { i18n } = useLingui();
  return (
    <select
      aria-label={translateMessage(i18n, MUSIC_MESSAGES.collection.label)}
      value={collection}
      onChange={event => onSelectCollection(event.target.value)}
    >
      {MUSIC_COLLECTIONS.map(entry => (
        <option key={entry.value} value={entry.value}>{translateMessage(i18n, entry.label)}</option>
      ))}
    </select>
  );
});

interface MusicPlaylistProps {
  currentIndex: string;
  disabled: boolean;
  options: readonly MusicPlaylistOption[];
  onPlaySelected: () => void;
  onSelectTrack: (value: string) => void;
}
/** Native listbox: arrows/Home/End/typeahead for free; double click plays the selection. */
const MusicPlaylist = memo(({ currentIndex, disabled, options, onPlaySelected, onSelectTrack }: MusicPlaylistProps) => {
  const { i18n } = useLingui();
  return (
    <select
      aria-label={translateMessage(i18n, MUSIC_MESSAGES.playlist.label)}
      disabled={disabled}
      size={10}
      value={currentIndex}
      onChange={event => onSelectTrack(event.target.value)}
      onDoubleClick={onPlaySelected}
    >
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
});

interface MusicUploadProps {
  onAddFiles: (input: HTMLInputElement) => void;
}
/** Themed label around a visually hidden, keyboard-reachable file input. */
const MusicUpload = memo(({ onAddFiles }: MusicUploadProps) => {
  const { i18n } = useLingui();
  return (
    <label className="music-player__upload">
      <SettlementIcon name="import" />
      {translateMessage(i18n, MUSIC_MESSAGES.upload.add)}
      <input
        accept="audio/*"
        aria-label={translateMessage(i18n, MUSIC_MESSAGES.upload.choose)}
        className="music-player__file-input"
        multiple
        type="file"
        onChange={event => onAddFiles(event.currentTarget)}
      />
    </label>
  );
});

export interface MusicPlayerViewProps extends MusicDeckProps {
  collection: string;
  currentIndex: string;
  playlist: readonly MusicPlaylistOption[];
  status: string;
  trackCount: string;
}
/** Body of the music player window: status, deck, collection, playlist and local files. */
export const MusicPlayerView = (props: MusicPlayerViewProps) => (
  <>
    <small role="status">{props.status}</small>
    <MusicDeck {...props} />
    <MusicCollectionSelect collection={props.collection} onSelectCollection={props.actions.onSelectCollection} />
    <small>{props.trackCount}</small>
    <MusicPlaylist
      currentIndex={props.currentIndex}
      disabled={props.transportDisabled}
      options={props.playlist}
      onPlaySelected={props.actions.onPlaySelected}
      onSelectTrack={props.actions.onSelectTrack}
    />
    <MusicUpload onAddFiles={props.actions.onAddFiles} />
  </>
);

interface MusicPlayerProps {
  service: MusicPlayerService;
}
const MusicPlayer = ({ service }: MusicPlayerProps) => <MusicPlayerView {...useMusicPlayer(service)} />;

/** The service is created once with the content and outlives the hidden window. */
export const mountMusicPlayer = (content: HTMLElement, nation: WorkerNation, i18n?: I18n) =>
  mountReactIsland(content, <MusicPlayer service={createBrowserMusicPlayer(nation, i18n)} />);
