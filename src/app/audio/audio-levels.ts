import { createExternalStore } from "../components/ui-store";
import { settingsStorage } from "../settings/graphics-settings";

/** Shared master and music levels: Settings > Sounds and the Music player both read and write these. */
export interface AudioLevels {
  /** 0..1 across every audio output. */
  master: number;
  /** 0..1 of the music category before the master level. */
  music: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const audioLevels = createExternalStore<AudioLevels>({
  master: settingsStorage.readMasterVolume(),
  music: settingsStorage.readMusicVolume()
});

export const setMasterVolume = (volume: number) => {
  const master = clamp(volume);
  settingsStorage.writeMasterVolume(master);
  audioLevels.set({ ...audioLevels.getSnapshot(), master });
};

export const setMusicVolume = (volume: number) => {
  const music = clamp(volume);
  settingsStorage.writeMusicVolume(music);
  audioLevels.set({ ...audioLevels.getSnapshot(), music });
};
