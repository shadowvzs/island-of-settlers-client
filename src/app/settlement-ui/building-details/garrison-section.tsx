import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import type { GarrisonComposition, GarrisonTroop } from "../../../shared/settlement/military-garrison-rules";
import type { MilitaryTrainingFocus } from "../../../shared/settlement/settlement-military";
import { CountStepper } from "../../components/count-stepper";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { RankChevrons } from "../rank-chevrons";
import type { SettlementGarrisonSummary, SettlementSoldierDetails } from "../types";
import {
  type GarrisonTroopRow, getChangedGarrisonPlan, getGarrisonView, getTrainingFocusChoices
} from "./garrison-helpers";

interface TroopRowProps {
  row: GarrisonTroopRow;
  onChange: (type: GarrisonTroop, delta: number) => void;
}
const TroopRow = ({ row, onChange }: TroopRowProps) => (
  <div className="settlement-ui__garrison-troop" data-garrison-troop={row.type}>
    <img alt="" draggable={false} src={row.icon} />
    <span>{row.name}</span>
    <CountStepper
      count={row.count}
      countLabel={row.countLabel}
      decreaseDisabled={row.decreaseDisabled}
      decreaseLabel={row.decreaseLabel}
      decreaseTitle={row.decreaseTitle}
      increaseDisabled={row.increaseDisabled}
      increaseLabel={row.increaseLabel}
      onDecrease={() => onChange(row.type, -1)}
      onIncrease={() => onChange(row.type, 1)}
    />
    <small>{row.stock}</small>
    {row.movement && <small className="settlement-ui__garrison-movement">{row.movement}</small>}
  </div>
);

interface TrainingFocusProps {
  focus: MilitaryTrainingFocus;
  note: string;
  onFocus: (focus: MilitaryTrainingFocus) => void;
}
const TrainingFocus = ({ focus, note, onFocus }: TrainingFocusProps) => {
  const { i18n } = useLingui();
  return (
    <>
      <label>
        {i18n._(M.details.garrison.focus)}{" "}
        <select
          aria-label={i18n._(M.details.garrison.focus)}
          value={focus}
          onChange={event => onFocus(event.target.value as MilitaryTrainingFocus)}
        >
          {getTrainingFocusChoices(i18n).map(choice =>
            <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </label>
      <small>{note}</small>
    </>
  );
};

interface GarrisonSectionProps {
  garrison: SettlementGarrisonSummary;
  nation: string;
  soldiers?: readonly SettlementSoldierDetails[];
  uid: number;
  onChange: (uid: number, counts: GarrisonComposition | null) => boolean;
  onCoinsAllowed?: (uid: number, allowed: boolean) => boolean | void;
  onTrainingFocus?: (uid: number, focus: MilitaryTrainingFocus) => boolean;
}
export const GarrisonSection = ({
  garrison, nation, soldiers, uid, onChange, onCoinsAllowed, onTrainingFocus
}: GarrisonSectionProps) => {
  const { i18n } = useLingui();
  const view = useMemo(() => getGarrisonView(garrison, nation, soldiers, i18n),
    [garrison, i18n, nation, soldiers]);
  const autoTitle = i18n._(M.details.garrison.autoTitle);
  const change = (type: GarrisonTroop, delta: number) => {
    const plan = getChangedGarrisonPlan(garrison, type, delta);
    if (plan) onChange(uid, plan);
  };
  const toggleCoins = () => onCoinsAllowed?.(uid, !view.supplies.coinsAllowed);
  return (
    <section aria-label={i18n._(M.details.garrison.aria)} className="settlement-ui__garrison">
      <b>{view.heading}</b>
      <div aria-label={i18n._(M.details.garrison.supplies)} className="settlement-ui__garrison-supplies"
        role="group">
        {!view.catapult && <>
        <button
          aria-label={view.supplies.coinToggleLabel}
          aria-pressed={view.supplies.coinsAllowed}
          className="settlement-ui__garrison-coin"
          data-coins-allowed={view.supplies.coinsAllowed}
          disabled={!onCoinsAllowed}
          title={view.supplies.coinToggleLabel}
          type="button"
          onClick={toggleCoins}
        >
          <img alt="" draggable={false} src={view.supplies.coinIcon} />
          {!view.supplies.coinsAllowed && <span aria-hidden="true"
            className="settlement-ui__garrison-coin-x">×</span>}
        </button>
        <span className="settlement-ui__garrison-supply">
          <output aria-label={view.supplies.coinStoredLabel}>{view.supplies.coinCount}</output>
          <small aria-hidden="true">/ {view.supplies.coinCapacity}</small>
          {view.supplies.coinIncoming && <small className="settlement-ui__garrison-incoming">
            {view.supplies.coinIncoming}
          </small>}
        </span>
        <span className="settlement-ui__garrison-supply" data-garrison-drink={garrison.drinkWare}>
          <WareIcon title={view.supplies.drinkName} ware={garrison.drinkWare} />
          <output aria-label={view.supplies.drinkStoredLabel}>{view.supplies.drinkCount}</output>
          <small aria-hidden="true">/ {view.supplies.drinkCapacity}</small>
          {view.supplies.drinkIncoming && <small className="settlement-ui__garrison-incoming">
            {view.supplies.drinkIncoming}
          </small>}
        </span>
        </>}
        {view.catapult && <span className="settlement-ui__garrison-supply" data-garrison-stone="true">
          <WareIcon title={view.stoneName} ware="stone" />
          <small>{view.stoneRoofLabel}</small>
          <output aria-label={view.stoneRoofLabel}>{view.stoneStock}</output>
          <small aria-hidden="true">/ 6</small>
          {view.stoneIncoming && <small>{view.stoneIncoming}</small>}
          <small>{view.stoneGroundLabel}</small>
          {view.stoneCarriedLabel && <small>{view.stoneCarriedLabel}</small>}
        </span>}
      </div>
      {view.catapultStatus && <output >{view.catapultStatus}</output>}
      <div aria-label={i18n._(M.details.garrison.insideHeading)} className="settlement-ui__garrison-inside"
        role="group">
        <h4>{i18n._(M.details.garrison.insideHeading)}</h4>
        {view.insideRows.map(row => (
          <div className="settlement-ui__garrison-inside-row" data-garrison-inside={row.key}
            data-rank={row.rank} key={row.key} title={row.title}>
            <span className="settlement-ui__soldier-portrait">
              <img alt="" draggable={false} src={row.icon} />
              <RankChevrons level={row.rank + 1} />
            </span>
            <span className="settlement-ui__garrison-inside-name">
              {row.typeName} <small>{row.rankName}</small>
            </span>
            <output aria-label={row.label}>{row.count}</output>
            {row.woundedText && <small className="settlement-ui__soldier-wounded">{row.woundedText}</small>}
          </div>
        ))}
        {view.insideEmpty && <small>{i18n._(M.details.garrison.insideEmpty)}</small>}
      </div>
      <div className="settlement-ui__garrison-plan-heading">
        <h4>{i18n._(M.details.garrison.planHeading)}</h4>
        <button
          aria-label={autoTitle}
          aria-pressed={view.automatic}
          className="settlement-ui__button settlement-ui__garrison-auto"
          title={autoTitle}
          type="button"
          onClick={() => onChange(uid, null)}
        >
          {i18n._(M.details.garrison.auto)}
        </button>
      </div>
      {view.rows.map(row => <TroopRow key={row.type} row={row} onChange={change} />)}
      {!view.catapult && onTrainingFocus && <TrainingFocus focus={view.trainingFocus} note={view.trainingNote}
        onFocus={focus => onTrainingFocus(uid, focus)} />}
    </section>
  );
};
