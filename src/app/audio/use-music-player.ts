import { useLingui } from "@lingui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useExternalStore } from "../components/external-store";
import { MUSIC_MESSAGES } from "./messages";
import {
  getMusicModeView,
  getMusicPlaybackView,
  getMusicPlaylistOptions,
  getMusicProgressView,
  getMusicStatusText,
  getMusicTrackCount,
  getMusicVolumeView
} from "./music-player-helpers";
import type { MusicPlayerService } from "./music-player-service";

/**
 * Seek drafts: the native `change` event (pointer release, each keyboard step) commits the seek;
 * React's `onChange` fires on every `input`, so it only moves the draft.
 */
const useSeekDraft = (service: MusicPlayerService) => {
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const seek = seekRef.current;
    if (!seek) return;
    const commit = () => { setScrubTo(null); service.seek(Number(seek.value)); };
    seek.addEventListener("change", commit);
    return () => seek.removeEventListener("change", commit);
  }, [service]);
  return {
    scrubTo,
    seekRef,
    onScrub: (value: string) => setScrubTo(Number(value)),
    onScrubEnd: () => setScrubTo(null)
  };
};

/** Stable callbacks, so memoized parts (collection, playlist) skip progress re-renders. */
export const createMusicPlayerActions = (service: MusicPlayerService) => ({
  onAddFiles: (input: HTMLInputElement) => {
    service.addLocalFiles([...input.files ?? []]);
    input.value = "";
  },
  onLoop: service.toggleLoop,
  onMute: service.toggleMute,
  onNext: service.next,
  onPlaySelected: service.playSelected,
  onPrevious: service.previous,
  onRepeat: service.toggleRepeat,
  onSelectCollection: service.selectCollection,
  onSelectTrack: (value: string) => service.selectTrack(Number(value)),
  onStop: service.stop,
  onTogglePlayback: service.togglePlayback,
  onVolume: (value: string) => service.setVolume(Number(value))
});

export type MusicPlayerActions = ReturnType<typeof createMusicPlayerActions>;

/** Prepared music player view: service snapshot plus the local seek draft, resolved in the active locale. */
export const useMusicPlayer = (service: MusicPlayerService) => {
  const { i18n } = useLingui();
  const state = useExternalStore(service.store);
  const { onScrub, onScrubEnd, scrubTo, seekRef } = useSeekDraft(service);
  const actions = useMemo(() => createMusicPlayerActions(service), [service]);
  const playlist = useMemo(() => getMusicPlaylistOptions(state.tracks), [state.tracks]);
  return {
    actions,
    collection: state.collection,
    currentIndex: String(state.currentIndex),
    loop: getMusicModeView(MUSIC_MESSAGES.transport.loop, state.loopCurrent, i18n),
    muted: state.muted,
    playback: getMusicPlaybackView(state, i18n),
    playlist,
    progress: getMusicProgressView(state, scrubTo, i18n),
    repeat: getMusicModeView(MUSIC_MESSAGES.transport.repeat, state.repeatPlaylist, i18n),
    seekRef,
    status: getMusicStatusText(state.status, i18n),
    trackCount: getMusicTrackCount(state.tracks, i18n),
    transportDisabled: !state.tracks.length,
    volume: state.volume,
    volumeView: getMusicVolumeView(state, i18n),
    onScrub,
    onScrubEnd
  };
};
