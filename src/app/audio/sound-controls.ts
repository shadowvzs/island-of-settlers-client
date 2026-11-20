import { SOUND_LAYERS, type SoundLayer } from "../settings/sound-settings";
import { setMasterVolume } from "./audio-levels";

interface SoundControlsOptions {
  enabled: boolean;
  environmentVolume: number;
  layersOff: ReadonlySet<SoundLayer>;
  setEnabled: (enabled: boolean) => void;
  setEnvironmentVolume: (volume: number) => void;
  setLayer: (layer: SoundLayer, on: boolean) => void;
}

/** Current sound settings shown by Settings > Sound. */
export interface SoundState {
  enabled: boolean;
  environmentVolume: number;
  layersOff: ReadonlySet<SoundLayer>;
}

/**
 * The Sounds settings adapter (React view in settings/sections): on / off, the environment category
 * volume and layer toggles. Master and music levels live in `audio-levels` because the Music player
 * is a separate audio element. The adapter keeps current values for the lazily mounted section.
 */
export const createSoundControls = (options: SoundControlsOptions) => {
  let { enabled, environmentVolume } = options;
  const layersOff = new Set(options.layersOff);
  const setLayer = (layer: SoundLayer, on: boolean) => {
    if (on && environmentVolume <= 0) return;
    if (on) layersOff.delete(layer);
    else layersOff.add(layer);
    options.setLayer(layer, on);
  };
  const uncheckSilentLayers = () => {
    if (environmentVolume > 0) return;
    for (const layer of SOUND_LAYERS) setLayer(layer, false);
  };
  uncheckSilentLayers();
  return {
    getState: (): SoundState => ({ enabled, environmentVolume, layersOff }),
    setEnabled: (next: boolean) => {
      enabled = next;
      options.setEnabled(next);
      setMasterVolume(next ? 1 : 0);
    },
    setEnvironmentVolume: (volume: number) => {
      environmentVolume = volume;
      options.setEnvironmentVolume(volume);
      uncheckSilentLayers();
    },
    setLayer
  };
};

export type SoundControls = ReturnType<typeof createSoundControls>;
