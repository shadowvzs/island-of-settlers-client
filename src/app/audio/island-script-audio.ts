import { settingsStorage } from "../settings/graphics-settings";
import { createAudioCuePlayer } from "./audio-cues";
import { audioLevels } from "./audio-levels";
import type { AudioUploadLookup } from "./audio-refs";
import { createMusicCueFader } from "./music-cue-fader";
import { existingBrowserMusicPlayer, type MusicPlayerService } from "./music-player-service";
import { createScriptAudio, type ScriptMusicTarget } from "./script-audio";

const NO_UPLOADS: AudioUploadLookup = () => undefined;

const musicTarget = (player: MusicPlayerService | null): ScriptMusicTarget | null => player && {
  playCueTrack: player.playCueTrack,
  playing: () => !player.store.getSnapshot().paused,
  setCueGain: player.setCueGain,
  stop: player.stop
};

/** The browser wiring of one island's script audio: stored sound settings, the page music player, a cue player. */
export const createIslandScriptAudio = (uploads: AudioUploadLookup = NO_UPLOADS, log?: (line: string) => void) => {
  const cues = createAudioCuePlayer();
  const fader = createMusicCueFader();
  const audio = createScriptAudio({
    cues,
    fader,
    levels: () => ({
      effects: settingsStorage.readEnvironmentVolume(), enabled: settingsStorage.readSound(),
      master: audioLevels.getSnapshot().master, music: audioLevels.getSnapshot().music
    }),
    log,
    music: () => musicTarget(existingBrowserMusicPlayer()),
    uploads
  });
  return {
    apply: audio.apply,
    dispose: () => {
      audio.dispose();
      fader.dispose();
      cues.dispose();
    }
  };
};
