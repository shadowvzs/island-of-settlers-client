import { LabelledButton } from "../../components/labelled-button";
import { EditorSection } from "../panel/fields";
import type { BuildingAvailabilityControls } from "./building-availability-controls";
import { useBuildingAvailability } from "./use-building-availability";
import type { BanButtonView, BuildingClickMode, ModeButtonView, TierButtonView } from "./view-model";

import "./building-availability.css";

interface TierButtonProps {
  tier: TierButtonView;
  onSelect: (tier: number) => void;
}
const TierButton = ({ tier, onSelect }: TierButtonProps) => (
  <LabelledButton className="building-availability__tier" label={tier.label} pressed={tier.pressed}
    onClick={() => onSelect(tier.tier)}>
    {tier.text}
  </LabelledButton>
);

interface ModeButtonProps {
  mode: ModeButtonView;
  onSelect: (mode: BuildingClickMode) => void;
}
/** What a building click edits: its ban or its max level. */
const ModeButton = ({ mode, onSelect }: ModeButtonProps) => (
  <LabelledButton className="building-availability__mode" label={mode.label} pressed={mode.pressed}
    onClick={() => onSelect(mode.mode)}>
    {mode.text}
  </LabelledButton>
);

interface BanButtonProps {
  ban: BanButtonView;
  onClick: (typeId: number) => void;
}
/** A building icon: pressed = banned on this map (dimmed and crossed); a "≤N" badge = its level cap. */
const BanButton = ({ ban, onClick }: BanButtonProps) => (
  <LabelledButton className={ban.className} label={ban.label} pressed={ban.pressed} onClick={() => onClick(ban.id)}>
    {ban.icon && <img alt="" draggable={false} src={ban.icon} />}
    {ban.capText && <span aria-hidden="true" className="building-availability__cap">{ban.capText}</span>}
  </LabelledButton>
);

interface BuildingAvailabilitySectionProps {
  controls: BuildingAvailabilityControls;
}
/** The map's highest tier, banned buildings and per-building max levels (MAP BUILDING AVAILABILITY, compact). */
export const BuildingAvailabilitySection = ({ controls }: BuildingAvailabilitySectionProps) => {
  const view = useBuildingAvailability(controls);
  return (
    <EditorSection info={view.info} title={view.title}>
      <div className="building-availability">
        <div className="building-availability__row">
          <span className="building-availability__label">{view.tierTitle}</span>
          {view.tiers.map(tier => <TierButton key={tier.tier} tier={tier} onSelect={view.onTierSelect} />)}
        </div>
        <div className="building-availability__row">
          {view.modes.map(mode => <ModeButton key={mode.mode} mode={mode} onSelect={view.onModeSelect} />)}
        </div>
        <div className="building-availability__bans">
          {view.bans.map(ban => <BanButton ban={ban} key={ban.id} onClick={view.onBuildingClick} />)}
        </div>
        {view.validation.length > 0 && (
          <ul className="building-availability__warnings">
            {view.validation.map(line => (
              <li data-severity={line.severity} key={line.key} role="alert">{line.text}</li>
            ))}
          </ul>
        )}
      </div>
    </EditorSection>
  );
};
