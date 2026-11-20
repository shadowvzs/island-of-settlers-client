import { useLingui } from "@lingui/react";
import { useState } from "react";

import type { SoundControls } from "../../audio/sound-controls";
import { useSetting } from "../../components/use-setting";
import type { SoundLayer } from "../sound-settings";
import { getSoundLayerRows } from "./helpers";

export const useSoundSettings = (controls: SoundControls) => {
  const { i18n } = useLingui();
  const [initial] = useState(controls.getState);
  const [enabled, setEnabled] = useSetting(initial.enabled, controls.setEnabled);
  const [volume, setVolume] = useSetting(initial.environmentVolume, controls.setEnvironmentVolume);
  const [layersOff, setLayersOff] = useState(() => new Set(initial.layersOff));
  return {
    enabled,
    layers: getSoundLayerRows(layersOff, i18n),
    volume,
    onEnabledChange: setEnabled,
    onLayerChange: (layer: SoundLayer, on: boolean) => {
      controls.setLayer(layer, on);
      setLayersOff(new Set(controls.getState().layersOff));
    },
    onVolumeInput: (next: number) => {
      setVolume(next);
      setLayersOff(new Set(controls.getState().layersOff));
    }
  };
};
