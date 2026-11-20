import { useLingui } from "@lingui/react";
import { useState } from "react";

import { QUALITY_LEVELS } from "../../render-common/quality";
import { audioLevels, setMasterVolume, setMusicVolume } from "../audio/audio-levels";
import { useExternalStore } from "../components/external-store";
import { settingsStorage } from "../settings/graphics-settings";
import { getDetailLevels } from "../settings/sections/helpers";
import { DEFAULT_TITLE_DETAIL } from "./constants";
import { TITLE_MESSAGES as M } from "./messages";

/**
 * The title page's viewer settings (plan §13.5): sound on/off and the music level apply at once (the title music
 * follows them); Detail is stored and applies when the game loads (no world exists yet).
 */
export const useTitleSettings = () => {
  const { i18n } = useLingui();
  const levels = useExternalStore(audioLevels);
  const [soundOn, setSoundOn] = useState(settingsStorage.readSound);
  const [detail, setDetail] = useState(() => settingsStorage.readDetail() ?? DEFAULT_TITLE_DETAIL);
  return {
    detailLevel: QUALITY_LEVELS.indexOf(detail),
    detailLevels: getDetailLevels(null, i18n),
    music: levels.music,
    soundOn,
    text: {
      detail: i18n._(M.settings.detail),
      detailHint: i18n._(M.settings.detailHint),
      music: i18n._(M.settings.music),
      sound: i18n._(M.settings.sound)
    },
    onDetail: (index: number) => {
      const level = QUALITY_LEVELS[index] ?? DEFAULT_TITLE_DETAIL;
      settingsStorage.writeDetail(level);
      setDetail(level);
    },
    onMusic: setMusicVolume,
    onSound: (enabled: boolean) => {
      settingsStorage.writeSound(enabled);
      setSoundOn(enabled);
      setMasterVolume(enabled ? 1 : 0);
    }
  };
};
