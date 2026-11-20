/**
 * CIN6 effects port of one island: weather and time-of-day steps drive the presentation environment controller
 * (real-time state, saved with the runtime blob, never part of the simulation or its replay), sound and music
 * steps the existing audio. A skipped step arrives with `transitionMs 0` / `instant`, its end state.
 */
import { type CinematicMusicTarget, createCinematicAudio } from "../../audio/cinematic-audio";
import { existingBrowserMusicPlayer, type MusicPlayerService } from "../../audio/music-player-service";
import { playVictoryFanfare } from "../../audio/victory-fanfare";
import type { EnvironmentController } from "../../environment-controller";
import type { CinematicRuntimeEffects } from "./cinematic-runtime";
import { MS_PER_SECOND } from "./constants";

export interface CinematicEffectsOptions {
  environment: Pick<EnvironmentController, "setWeather" | "transitionToHour">;
  /** The island soundscape's thunder (the renderer's strike already plays it with the bolt). */
  playThunder: () => void;
}

const musicTarget = (player: MusicPlayerService | null): CinematicMusicTarget | null => player && {
  playing: () => !player.store.getSnapshot().paused,
  playTrackById: player.playTrackById,
  setCueGain: player.setCueGain,
  stop: player.stop
};

export const createCinematicEffects = ({ environment, playThunder }: CinematicEffectsOptions) => {
  const audio = createCinematicAudio({
    cues: { thunder: playThunder, "victory-fanfare": playVictoryFanfare },
    music: () => musicTarget(existingBrowserMusicPlayer())
  });
  const effects: CinematicRuntimeEffects = {
    music: audio.music,
    sound: audio.sound,
    timeOfDay: (hour, instant) => environment.transitionToHour(hour, instant ? 0 : undefined),
    weather: (state, transitionMs) => environment.setWeather(state, transitionMs / MS_PER_SECOND)
  };
  return { dispose: audio.dispose, effects };
};
