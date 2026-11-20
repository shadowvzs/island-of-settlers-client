import { AccountSettings } from "../account/settings/account-settings";
import type { AccountSettingsOptions } from "../account/settings/helpers";
import { Checkbox } from "../components/checkbox";
import { LevelSlider, Slider } from "../components/slider";
import { LanguageSettings } from "../settings/language/language-panel";
import { useTitleSettings } from "./use-title-settings";

import "../settings/settings.css";
import "../settings/language/language.css";

interface TitleSettingsProps {
  /** Signed in: Log out and Switch save slot. */
  account?: AccountSettingsOptions;
}
/** The title page's viewer settings (plan §13.5): language, sound, music level, stored Detail, account. */
export const TitleSettings = ({ account }: TitleSettingsProps) => {
  const model = useTitleSettings();
  return (
    <div className="title-page__settings">
      <LanguageSettings />
      <Checkbox checked={model.soundOn} label={model.text.sound} onChange={model.onSound} />
      <Slider label={model.text.music} value={model.music} onInput={model.onMusic} />
      <LevelSlider
        info={{ label: model.text.detail, text: model.text.detailHint }}
        label={model.text.detail}
        level={model.detailLevel}
        levels={model.detailLevels}
        onInput={model.onDetail}
      />
      {account && <AccountSettings {...account} />}
    </div>
  );
};
