import { IconButton } from "../../components/icon-button";
import { InlineInfo } from "../../components/info-hint";
import { Section } from "../../components/section";
import { useSeasonalAppearance } from "./use-seasonal-appearance";

export interface SeasonalAppearanceViewProps {
  disabled: boolean;
  error?: string;
  hint: string;
  label: string;
  pressed: boolean;
  sectionTitle: string;
  status: string;
  title: string;
  onToggle: () => void;
}

export const SeasonalAppearanceView = ({
  disabled, error, hint, label, pressed, sectionTitle, status, title, onToggle
}: SeasonalAppearanceViewProps) => (
  <Section icon="island-winter" title={sectionTitle}>
    <div className="settings-panel__control-row">
      <IconButton disabled={disabled} icon="island-winter" label={label} pressed={pressed} title={title}
        onClick={onToggle} />
      <InlineInfo info={{ label: sectionTitle, text: hint }} />
    </div>
    <p aria-live="polite" className="settings-panel__hint">{status}</p>
    {error && <p role="alert">{error}</p>}
  </Section>
);

/** Every player can opt out of the global cosmetic season in this browser. */
export const SeasonalAppearanceSection = () => <SeasonalAppearanceView {...useSeasonalAppearance()} />;
