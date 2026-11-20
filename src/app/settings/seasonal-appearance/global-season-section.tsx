import type { SeasonMode, VisualSeason } from "../../../../../island-of-settlers-shared/src/appearance/season-calendar";
import type { SelectOption } from "../../components/helpers";
import { InlineInfo } from "../../components/info-hint";
import { Section } from "../../components/section";
import { Select } from "../../components/select";
import { useGlobalSeason } from "./use-global-season";

export interface GlobalSeasonViewProps {
  error?: string;
  fixedSeason: VisualSeason;
  fixedSeasonHint: string;
  fixedSeasonLabel: string;
  hint: string;
  mode: SeasonMode;
  modeChoices: SelectOption<SeasonMode>[];
  modeLabel: string;
  seasonChoices: SelectOption<VisualSeason>[];
  status: string;
  title: string;
  transitionChoices: SelectOption<number>[];
  transitionLabel: string;
  transitionSeconds: number;
  onFixedSeasonChange: (season: VisualSeason) => void;
  onModeChange: (mode: SeasonMode) => void;
  onTransitionChange: (seconds: number) => void;
}

export const GlobalSeasonView = ({
  error, fixedSeason, fixedSeasonHint, fixedSeasonLabel, hint, mode, modeChoices, modeLabel, seasonChoices, status,
  title, transitionChoices, transitionLabel, transitionSeconds, onFixedSeasonChange, onModeChange, onTransitionChange
}: GlobalSeasonViewProps) => (
  <Section icon="island-winter" title={title}>
    <div className="settings-panel__control-row">
      <Select choices={modeChoices} label={modeLabel} selected={mode} onChange={onModeChange} />
      <InlineInfo info={{ label: title, text: hint }} />
    </div>
    <Select choices={seasonChoices} info={{ label: fixedSeasonLabel, text: fixedSeasonHint }} label={fixedSeasonLabel}
      selected={fixedSeason} onChange={onFixedSeasonChange} />
    <Select choices={transitionChoices} label={transitionLabel} selected={transitionSeconds}
      onChange={onTransitionChange} />
    <p aria-live="polite" className="settings-panel__hint">{status}</p>
    {error && <p role="alert">{error}</p>}
  </Section>
);

/** Admin controls are mounted only by the authenticated administrator's Development panel. */
export const GlobalSeasonSection = () => <GlobalSeasonView {...useGlobalSeason()} />;
