import type { KeyboardEvent } from "react";

import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { SettlementIcon } from "../../components/settlement-icon";
import type { ArmyRailView, TroopTypeChoice } from "./helpers";
import { RailButton, RailImage } from "./rail-button";

interface TroopTypeToggleProps {
  choice: TroopTypeChoice;
  onToggle: (type: MilitaryTroopType) => void;
}
const TroopTypeToggle = ({ choice: { checked, count, disabled, icon, label, type }, onToggle }:
  TroopTypeToggleProps) => (
  <label title={type}>
    <input aria-label={label} checked={checked} disabled={disabled} type="checkbox" onChange={() => onToggle(type)} />
    <RailImage source={icon} />
    <span>{count}</span>
  </label>
);

interface RallyPanelProps {
  view: ArmyRailView;
  onClose: () => void;
  onGather: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onToggleType: (type: MilitaryTroopType) => void;
}
/** Troop type choice for the rally banner and the "send to the banner" action. */
export const RallyPanel = ({ view, onClose, onGather, onKeyDown, onToggleType }: RallyPanelProps) => (
  // Delegate child-control keyboard actions without giving the whole region a new interactive role.
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  <section aria-label="Select troop types" className="army-action-rail__rally" hidden={view.rallyHidden}
    onKeyDown={onKeyDown}>
    <div className="army-action-rail__panel-header">
      <strong>Select troops</strong>
      <RailButton className="army-action-rail__close settlement-ui__button" label="Close troop selection"
        onClick={onClose}>
        <SettlementIcon name="cancel" />
      </RailButton>
    </div>
    <div className="army-action-rail__types">
      {view.choices.map(choice => <TroopTypeToggle choice={choice} key={choice.type} onToggle={onToggleType} />)}
    </div>
    <small className="army-action-rail__empty" hidden={view.emptyHidden}>
      No free soldiers. Recruit soldiers at the Military Academy; garrisons stay in their buildings.
    </small>
    <div className="army-action-rail__rally-actions">
      <RailButton className="settlement-ui__button army-action-rail__gather" disabled={view.gatherDisabled}
        hidden={view.gatherHidden} label="Send the chosen troops to the rally banner" onClick={onGather}>
        {view.gatherIcons.map(source => <RailImage key={source} source={source} />)}
      </RailButton>
    </div>
  </section>
);
