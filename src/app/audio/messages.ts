import { msg } from "@lingui/core/macro";

/**
 * Music player chrome: collection filters, transport and volume labels, playlist status and the
 * lazily loaded window's loading text. Track titles and local filenames are data and stay as they are.
 */
export const MUSIC_MESSAGES = {
  collection: {
    all: msg({ id: "music.collection.all", message: "All music" }),
    chinese: msg({ id: "account.race.chinese", message: "Chinese" }),
    indigenous: msg({ id: "account.race.indigenous", message: "Indigenous" }),
    japanese: msg({ id: "music.collection.japanese", message: "Japanese" }),
    label: msg({ id: "music.collection.label", message: "Music collection" }),
    local: msg({ id: "music.collection.local", message: "My local files" }),
    maya: msg({ id: "music.collection.maya", message: "Maya" }),
    neutral: msg({ id: "music.collection.neutral", message: "Neutral" }),
    nubian: msg({ id: "music.collection.nubian", message: "Nubian" }),
    persian: msg({ id: "account.race.persian", message: "Persian" }),
    roman: msg({ id: "music.collection.roman", message: "Roman" }),
    viking: msg({ id: "domain.nation.viking", message: "Viking" })
  },
  controls: {
    label: msg({ id: "music.controls.label", message: "Music controls" })
  },
  mode: {
    off: msg({ id: "music.mode.off", message: "{label}: off" }),
    on: msg({ id: "music.mode.on", message: "{label}: on" })
  },
  player: {
    playback: msg({ id: "music.player.playback", message: "Music playback" })
  },
  playlist: {
    label: msg({ id: "music.playlist.label", message: "Music playlist" })
  },
  progress: {
    label: msg({ id: "music.progress.label", message: "Track progress" }),
    time: msg({ id: "music.progress.time", message: "{current} / {total}" }),
    value: msg({ id: "music.progress.value", message: "{current} of {total}" })
  },
  status: {
    autoplayBlocked: msg({
      id: "music.status.autoplayBlocked",
      message: "{track} — press Play to start."
    }),
    emptyPlaylist: msg({
      id: "music.status.emptyPlaylist",
      message: "Choose local audio files to create a playlist."
    }),
    unplayable: msg({
      id: "music.status.unplayable",
      message: "This audio file could not be played. Choose another track."
    })
  },
  trackCount: {
    one: msg({ id: "music.trackCount.one", message: "{count} track" }),
    other: msg({ id: "music.trackCount.other", message: "{count} tracks" })
  },
  transport: {
    loop: msg({ id: "music.transport.loop", message: "Loop current track" }),
    next: msg({ id: "music.transport.next", message: "Next track" }),
    pause: msg({ id: "music.transport.pause", message: "Pause" }),
    play: msg({ id: "music.transport.play", message: "Play" }),
    previous: msg({ id: "music.transport.previous", message: "Previous track" }),
    repeat: msg({ id: "music.transport.repeat", message: "Repeat playlist" }),
    resume: msg({ id: "music.transport.resume", message: "Resume" }),
    stop: msg({ id: "music.transport.stop", message: "Stop" })
  },
  upload: {
    add: msg({ id: "music.upload.add", message: "Add local files" }),
    choose: msg({ id: "music.upload.choose", message: "Choose local music files" })
  },
  volume: {
    label: msg({ id: "music.volume.label", message: "Music volume" }),
    mute: msg({ id: "music.volume.mute", message: "Mute music" }),
    muted: msg({ id: "music.volume.muted", message: "Muted" }),
    percent: msg({ id: "music.volume.percent", message: "{percent} percent" }),
    unmute: msg({ id: "music.volume.unmute", message: "Unmute music" })
  },
  window: {
    loadFailed: msg({
      id: "music.window.loadFailed",
      message: "The music player could not load. Close and reopen to retry."
    }),
    loading: msg({ id: "music.window.loading", message: "Loading music player…" })
  }
} as const;
