/**
 * Campaign cinematic audio hooks (CIN6): `sound` plays a named cue through the existing synthesized sounds,
 * `music` switches the page's music player to a bundled track (catalog id, the per-map music stays a string id)
 * with a fade out / fade in, or fades it out and stops it (`null`). Unknown ids are no-ops (the editor's Ready
 * check reports them). Presentation only: nothing here is saved or recorded.
 */
import { CINEMATIC_SOUND_CUE_IDS } from "./constants";
import { createMusicCueFader, type MusicCueFaderOptions, type MusicCueTarget } from "./music-cue-fader";

export type CinematicSoundCueId = (typeof CINEMATIC_SOUND_CUE_IDS)[number];

/** The parts of the music player a cue drives. */
export interface CinematicMusicTarget extends MusicCueTarget {
  playTrackById: (trackId: string) => boolean;
}

export interface CinematicAudioOptions extends MusicCueFaderOptions {
  cues: Readonly<Record<CinematicSoundCueId, () => void>>;
  /** The page's music player, if any. */
  music: () => CinematicMusicTarget | null;
}

const isCueId = (cueId: string): cueId is CinematicSoundCueId =>
  (CINEMATIC_SOUND_CUE_IDS as readonly string[]).includes(cueId);

export const createCinematicAudio = (options: CinematicAudioOptions) => {
  const fader = createMusicCueFader(options);

  /** `fadeMs`: the whole change; half fades the current track out, half fades the new one in. */
  const music = (trackId: string | null, fadeMs: number) => {
    const target = options.music();
    if (!target) return;
    const half = fadeMs / 2;
    fader.change(target, {
      fadeInMs: target.playing() ? half : fadeMs,
      fadeOutMs: trackId === null ? fadeMs : half,
      gain: 1,
      start: trackId === null ? null : () => target.playTrackById(trackId)
    });
  };

  const sound = (cueId: string) => {
    if (isCueId(cueId)) options.cues[cueId]();
  };

  return { dispose: fader.dispose, music, sound };
};

export type CinematicAudio = ReturnType<typeof createCinematicAudio>;
