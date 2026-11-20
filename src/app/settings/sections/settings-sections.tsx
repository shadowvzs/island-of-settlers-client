import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";

import type { CharacterDetailChoice } from "../../../render-common/character-detail";
import type { ColorTone } from "../../../render-common/color-output";
import { QUALITY_PRESETS, type QualityLevel } from "../../../render-common/quality";
import type { ResolutionMode } from "../../../render-common/resolution";
import { AccountSettings } from "../../account/settings/account-settings";
import type { AccountSettingsOptions } from "../../account/settings/helpers";
import type { SoundControls } from "../../audio/sound-controls";
import { useExternalStore } from "../../components/external-store";
import { Section } from "../../components/section";
import { Tabs } from "../../components/tabs";
import type { ReadableStore } from "../../components/ui-store";
import type { TabRequest } from "../../components/use-tabs";
import { NotificationSettings } from "../../notifications/settings-section";
import type { RenderBudgetControls } from "../../render-budget/render-budget";
import type { WeatherControls } from "../../weather-controls";
import { AdaptivePerformanceSection } from "../adaptive-performance/adaptive-performance-section";
import { DialogueSpeedSection } from "../dialogue-speed/dialogue-speed-section";
import { GameSection, type GameSectionOptions } from "../game-section/game-section";
import type { ApplyDetail } from "../graphics-settings";
import { HotkeySection } from "../hotkeys/hotkey-section";
import { HOTKEY_MESSAGES } from "../hotkeys/messages";
import { MouseRotationSection } from "../mouse-rotation/mouse-rotation-section";
import { SEASONAL_APPEARANCE_MESSAGES } from "../seasonal-appearance/messages";
import { SeasonalAppearanceSection } from "../seasonal-appearance/seasonal-appearance-section";
import { SystemCursorSection } from "../system-cursor/system-cursor-section";
import { DayModeSection } from "./day-mode-section";
import { GraphicsSection } from "./graphics-section";
import { SETTINGS_MESSAGES } from "./messages";
import { SoundSection } from "./sound-section";
import { WorldSection } from "./world-section";

import "../settings.css";

export interface SettingsSectionsProps {
  /** Signed-in player (Settings > Account: log out, password, export, delete); absent for guests. */
  account?: AccountSettingsOptions;
  applyCharacterDetail: (choice: CharacterDetailChoice) => void;
  applyDetail?: ApplyDetail;
  applyResolution: (mode: ResolutionMode) => void;
  /** Adaptive performance controls; absent where no island renders. */
  budget?: RenderBudgetControls;
  /** Character detail cap and cadence floor (Settings > Graphics); its ✓ applies it live. */
  characterDetail: CharacterDetailChoice;
  critters: boolean;
  detail: QualityLevel;
  fog: boolean;
  fogLocked?: () => boolean;
  /** Exit game (GS3b): only where a title page exists. */
  game?: GameSectionOptions;
  /** Highlights / glare strength 0..1 (Settings > Graphics), applied live. */
  highlights: number;
  recommended: QualityLevel | null;
  resolution: ResolutionMode;
  /** The tab a script opening asks for (TRG9). */
  sectionRequest: ReadableStore<TabRequest | null>;
  sound: SoundControls;
  tone: ColorTone;
  weather: WeatherControls;
  setCritters: (enabled: boolean) => void;
  setFog: (visible: boolean) => void;
  setHighlights: (strength: number) => void;
  setTone: (tone: ColorTone) => void;
}

/** The Settings corner panel's sections, below the panel header owned by `corner-panel.ts`. */
const getSectionItems = (props: SettingsSectionsProps, i18n: I18n) => [
  {
    content: (
      <>
        <GraphicsSection applyCharacterDetail={props.applyCharacterDetail}
          applyDetail={props.applyDetail} applyResolution={props.applyResolution}
          characterDetail={props.characterDetail} detail={props.detail}
          highlights={props.highlights} recommended={props.recommended} resolution={props.resolution}
          setHighlights={props.setHighlights} setTone={props.setTone} tone={props.tone} />
        {props.budget && (
          <AdaptivePerformanceSection
            budget={props.budget}
            detailFloor={QUALITY_PRESETS[props.detail].renderScaleMin}
          />
        )}
      </>
    ),
    id: "graphics",
    label: i18n._(SETTINGS_MESSAGES.tabs.graphics)
  },
  {
    content: <SeasonalAppearanceSection />,
    id: "appearance",
    label: i18n._(SEASONAL_APPEARANCE_MESSAGES.title)
  },
  { content: <SoundSection sound={props.sound} />, id: "sounds", label: i18n._(SETTINGS_MESSAGES.tabs.sounds) },
  {
    content: (
      <>
        <MouseRotationSection />
        <HotkeySection />
      </>
    ),
    id: "hotkeys",
    label: i18n._(HOTKEY_MESSAGES.title)
  },
  {
    content: (
      <>
        <NotificationSettings />
        <DialogueSpeedSection />
        <SystemCursorSection />
        <DayModeSection weather={props.weather} />
        <WorldSection
          critters={props.critters}
          fog={props.fog}
          fogLocked={props.fogLocked}
          setCritters={props.setCritters}
          setFog={props.setFog}
        />
        {props.account && (
          <Section icon="people" title={i18n._(SETTINGS_MESSAGES.account.title)}>
            <AccountSettings {...props.account} />
          </Section>
        )}
        {props.game && <GameSection {...props.game} />}
      </>
    ),
    id: "misc",
    label: i18n._(SETTINGS_MESSAGES.tabs.misc)
  }
];

/** The Settings corner panel's tabs: Graphics, Appearance, Sounds and Misc. */
export const SettingsSections = (props: SettingsSectionsProps) => {
  const { i18n } = useLingui();
  const request = useExternalStore(props.sectionRequest);
  return (
    <Tabs
      idPrefix="settings"
      items={getSectionItems(props, i18n)}
      label={i18n._(SETTINGS_MESSAGES.tabs.label)}
      listClassName="settings-panel__tabs"
      panelClassName="settings-panel__tab-content"
      request={request}
    />
  );
};
