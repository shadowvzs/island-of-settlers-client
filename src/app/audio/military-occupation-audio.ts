import { audioEntry } from "@shared/catalog";

import { settingsStorage } from "../settings/graphics-settings";
import { audioEntryUrl } from "./audio-asset-urls";
import { audioLevels } from "./audio-levels";
import { GARRISON_TRUMPET_SOUND_ID } from "./constants";
import { createFirstOccupationObserver, type OccupationSite,occupationTrumpetGain } from "./first-occupation";

/** A quiet original FluidR3 trumpet phrase follows the existing SFX/environment and master controls. */
export const createMilitaryOccupationAudio = (initial: readonly OccupationSite[]) => {
  let voice: HTMLAudioElement | undefined;
  const trumpet = audioEntry("sound", GARRISON_TRUMPET_SOUND_ID);
  const trumpetUrl = trumpet && audioEntryUrl(trumpet);
  const gain = () => occupationTrumpetGain(settingsStorage.readSound(), audioLevels.getSnapshot().master,
    settingsStorage.readEnvironmentVolume());
  const observe = createFirstOccupationObserver(initial, () => {
    const volume = gain();
    if (volume <= 0 || !trumpetUrl) return;
    voice ??= new Audio(trumpetUrl);
    voice.volume = volume; voice.currentTime = 0;
    void voice.play().catch(() => {});
  });
  return {
    update: (sites: readonly OccupationSite[]) => {
      // Mark muted events heard as well: enabling sound must not replay past occupations.
      observe(sites);
      if (!voice) return;
      voice.volume = gain();
      if (voice.volume === 0) voice.pause();
    },
    dispose: () => { observe.dispose(); if (voice) { voice.pause(); voice.src = ""; voice = undefined; } }
  };
};
