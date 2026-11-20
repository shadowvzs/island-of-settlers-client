import { SettlementIcon } from "../../components/settlement-icon";
import type { ExternalStore } from "../../components/ui-store";
import type { ArmyRailActions } from "../army-action-rail";
import { BoxSelectionIcon } from "./box-selection-icon";
import { GroupBadges } from "./group-badges";
import type { ArmyRailState } from "./helpers";
import { RailButton, RailImage } from "./rail-button";
import { RallyPanel } from "./rally-panel";
import { useArmyRail } from "./use-army-rail";

interface ArmyRailViewProps {
  actions: ArmyRailActions;
  store: ExternalStore<ArmyRailState>;
}
/** Soldier action rail content (inside `aside.army-action-rail`): count, orders, selection and rally. */
export const ArmyRailContent = ({ actions, store }: ArmyRailViewProps) => {
  const { onRallyKeyDown, rallyButton, view } = useArmyRail(store, actions);
  return (
    <>
      <span aria-live="polite" className="army-action-rail__count">{view.selectedCount}</span>
      <span aria-live="polite" className="army-action-rail__instruction" role="status">{view.instruction}</span>
      <div className="army-action-rail__actions" hidden={view.actionsHidden}>
        {view.actions.map(({ action, disabled, icon, label, pressed, title }) => (
          <RailButton disabled={disabled} key={action} label={label} pressed={pressed} title={title}
            onClick={() => actions.onAction(action)}>
            <RailImage source={icon} />
          </RailButton>
        ))}
      </div>
      <RailButton label={view.boxSelectLabel} pressed={view.addPressed} title={view.boxSelectTitle}
        onClick={actions.onToggleAdding}>
        <BoxSelectionIcon />
      </RailButton>
      <GroupBadges groups={view.groups} heading={view.groupsHeading} hidden={view.groupsHidden}
        onRecall={actions.onRecallGroup} />
      <RailButton expanded={!view.rallyHidden} label="Select troops" ref={rallyButton} onClick={actions.onToggleRally}>
        <RailImage source={view.selectionIcon} />
      </RailButton>
      <RailButton className="army-action-rail__button settlement-ui__button army-action-rail__send"
        label="Choose rally point" pressed={view.sendPressed} onClick={actions.onChooseRallyPoint}>
        <RailImage source={view.rallyFlagIcon} />
      </RailButton>
      <RailButton hidden={view.cancelRallyHidden} label="Cancel rally point" onClick={actions.onCancelRally}>
        <SettlementIcon name="cancel" />
      </RailButton>
      <RallyPanel view={view} onClose={actions.closeRally} onGather={actions.onGather} onKeyDown={onRallyKeyDown}
        onToggleType={actions.onToggleType} />
    </>
  );
};
