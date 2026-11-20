import { useLingui } from "@lingui/react";

import { audioLevels, setMasterVolume, setMusicVolume } from "../../audio/audio-levels";
import type { SoundControls } from "../../audio/sound-controls";
import { Checkbox } from "../../components/checkbox";
import { useExternalStore } from "../../components/external-store";
import { Section } from "../../components/section";
import { Slider } from "../../components/slider";
import type { SoundLayer } from "../sound-settings";
import type { SoundLayerRow } from "./helpers";
import { SETTINGS_MESSAGES } from "./messages";
import { useSoundSettings } from "./use-sound-settings";

interface SoundSectionViewProps {
  enabled: boolean;
  layers: readonly SoundLayerRow[];
  masterVolume: number;
  musicVolume: number;
  volume: number;
  onEnabledChange: (enabled: boolean) => void;
  onLayerChange: (layer: SoundLayer, on: boolean) => void;
  onMasterInput: (volume: number) => void;
  onMusicInput: (volume: number) => void;
  onVolumeInput: (volume: number) => void;
}
const SoundSectionView = ({
  enabled, layers, masterVolume, musicVolume, volume, onEnabledChange, onLayerChange,
  onMasterInput, onMusicInput, onVolumeInput
}: SoundSectionViewProps) => {
  const { i18n } = useLingui();
  return (
    <Section icon="sound" title={i18n._(SETTINGS_MESSAGES.sound.title)}>
      <div className="sound-controls">
        <Checkbox checked={enabled} label={i18n._(SETTINGS_MESSAGES.sound.enabled)} onChange={onEnabledChange} />
        <Slider label={i18n._(SETTINGS_MESSAGES.sound.masterVolume)} value={masterVolume} onInput={onMasterInput} />
        <hr className="sound-controls__divider" />
        <Slider label={i18n._(SETTINGS_MESSAGES.sound.musicVolume)} value={musicVolume} onInput={onMusicInput} />
        <Slider label={i18n._(SETTINGS_MESSAGES.sound.environmentVolume)} value={volume} onInput={onVolumeInput} />
        <div className="sound-controls__layers">
          {layers.map(({ checked, label, layer }) => (
            <Checkbox checked={checked} disabled={volume === 0} key={layer}
              label={label} onChange={on => onLayerChange(layer, on)} />
          ))}
        </div>
      </div>
    </Section>
  );
};

interface SoundSectionProps {
  sound: SoundControls;
}
/** Master, music and environment levels plus the environment layer toggles. */
export const SoundSection = ({ sound }: SoundSectionProps) => {
  const levels = useExternalStore(audioLevels);
  const settings = useSoundSettings(sound);
  return (
    <SoundSectionView
      {...settings}
      masterVolume={levels.master}
      musicVolume={levels.music}
      onMasterInput={setMasterVolume}
      onMusicInput={setMusicVolume}
    />
  );
};
