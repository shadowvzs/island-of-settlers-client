import { useLingui } from "@lingui/react";

import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { Inventory } from "../../components/inventory";
import { NumberStepper } from "../../components/number-stepper";
import { SettlementIcon } from "../../components/settlement-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { CommanderPicker } from "./commander-picker";
import type { PlannerDetails, PlannerTroopRow } from "./helpers";
import { IslandChoices } from "./island-choices";
import {
  type ExpeditionPlannerContext, type ExpeditionPlannerView, useExpeditionPlanner
} from "./use-expedition-planner";

interface TroopRowsProps {
  rows: readonly PlannerTroopRow[];
  onChange: (type: MilitaryTroopType, value: number) => void;
}
const TroopRows = ({ rows, onChange }: TroopRowsProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.planner.troopsAria)} className="colony-planner__troops">
    {rows.map(row => (
      <label className="colony-planner__troop" key={row.type}>
        <img alt="" draggable={false} src={row.icon} />
        <span>{row.name}</span>
        <small>{row.stored}</small>
        <NumberStepper
          buttonClassName="settlement-ui__button colony-planner__step"
          decreaseLabel={row.decreaseLabel}
          increaseLabel={row.increaseLabel}
          label={row.label}
          max={row.max}
          value={row.value}
          onChange={value => onChange(row.type, value)}
        />
      </label>
    ))}
  </section>
  );
};

interface DetailsProps {
  details: PlannerDetails;
}
/** Colony: supplies and crew. Adventure: the reward preview (empty until an island is offered). */
const PlannerDetailsView = ({ details }: DetailsProps) => {
  const { i18n } = useLingui();
  if (details.kind === "colony") {
    return (
      <>
        <Inventory heading={i18n._(M.planner.supplies)} inventory={details.supplies} />
        <p className="settlement-ui__section-description">{details.crew}</p>
      </>
    );
  }
  return (
    <section className="colony-planner__reward">
      {details.reward && <p className="colony-planner__total">{details.reward.experience}</p>}
      {details.reward && <Inventory heading={i18n._(M.planner.rewardShip)} inventory={details.reward.goods} />}
    </section>
  );
};

interface ExpeditionPlannerViewProps {
  islandLabel: string;
  view: ExpeditionPlannerView;
}
const PlannerView = ({ islandLabel, view }: ExpeditionPlannerViewProps) => {
  const { i18n } = useLingui();
  return (
  <>
    <IslandChoices cards={view.islands} label={islandLabel} onChoose={view.onChooseIsland} />
    <p className="colony-planner__threat">{view.threat}</p>
    <TroopRows rows={view.troops} onChange={view.onTroopChange} />
    <p className="colony-planner__total">{view.total}</p>
    <CommanderPicker cards={view.commanderCards} heading={i18n._(M.planner.commanderHeading)}
      summary={view.commanderSummary} onChoose={view.onChooseCommander} />
    <PlannerDetailsView details={view.details} />
    <p className="colony-planner__estimate">
      <SettlementIcon name="ship" />
      <span>{view.estimate}</span>
    </p>
    <button
      aria-label={i18n._(M.planner.start)}
      className="settlement-ui__button settlement-ui__button--primary"
      disabled={view.startDisabled}
      title={view.startTitle}
      type="button"
      onClick={view.onStart}
    >
      <SettlementIcon name="ship" />
      <span>{i18n._(M.planner.start)}</span>
    </button>
    <small role="status">{view.status}</small>
  </>
  );
};

interface ExpeditionPlannerProps {
  context: ExpeditionPlannerContext;
  islandLabel: string;
}
/** Harbour planner: an island (fixed difficulty) and troops; the simulation validates and pays. */
export const ExpeditionPlanner = ({ context, islandLabel }: ExpeditionPlannerProps) => (
  <PlannerView islandLabel={islandLabel} view={useExpeditionPlanner(context)} />
);
