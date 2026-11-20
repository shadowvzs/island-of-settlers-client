import type { CameraState } from "../../render-common/camera-state";
import type { WorldData } from "../../shared/world/world-data";
import { settingsStorage } from "../settings/graphics-settings";
import { createAmbientSoundscape } from "./ambient-soundscape";
import { audioLevels } from "./audio-levels";
import { createAnimalSoundSource, createBirdSoundSource } from "./creature-sources";
import { createSoundControls } from "./sound-controls";

interface IslandSoundOptions {
  camera: CameraState;
  getHour: () => number;
  world: WorldData;
}

/**
 * App wiring of the soundscape: stored settings in, the settings section out, every change
 * stored. Birds and land animals are creature sources (wrap their updates with `trackBirds` /
 * `trackAnimals`); events can call `soundscape.emitCreatureSound`.
 */
export const createIslandSound = ({ camera, getHour, world }: IslandSoundOptions) => {
  const settings = {
    enabled: settingsStorage.readSound(),
    layersOff: settingsStorage.readSoundLayersOff(),
    masterVolume: audioLevels.getSnapshot().master,
    volumes: { environment: settingsStorage.readEnvironmentVolume() }
  };
  const soundscape = createAmbientSoundscape({ camera, getHour, settings, world });
  const birds = createBirdSoundSource();
  const animals = createAnimalSoundSource();
  soundscape.addCreatureSource(birds.source);
  soundscape.addCreatureSource(animals.source);
  let disposed = false;
  const unsubscribeLevels = audioLevels.subscribe(() =>
    soundscape.setMasterVolume(audioLevels.getSnapshot().master));
  const controls = createSoundControls({
    enabled: settings.enabled,
    environmentVolume: settings.volumes.environment,
    layersOff: settings.layersOff,
    setEnabled: (enabled) => {
      soundscape.setEnabled(enabled);
      settingsStorage.writeSound(enabled);
    },
    setEnvironmentVolume: (volume) => {
      soundscape.setVolume("environment", volume);
      settingsStorage.writeEnvironmentVolume(volume);
    },
    setLayer: (layer, on) => {
      soundscape.setLayer(layer, on);
      settingsStorage.writeSoundLayersOff(settings.layersOff);
    }
  });
  return {
    controls,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeLevels();
      soundscape.dispose();
    },
    onTreeFelled: soundscape.onTreeFelled,
    playThunder: soundscape.playThunder,
    soundscape,
    trackAnimals: animals.track,
    trackBirds: birds.track,
    trackEnvironment: soundscape.trackEnvironment
  };
};
