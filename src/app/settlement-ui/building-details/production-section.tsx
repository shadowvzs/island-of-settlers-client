import { useLingui } from "@lingui/react";

import { displayWareName } from "../../../shared/i18n/domain";
import { ProgressBar } from "../../components/progress-bar";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";
import { getActivityText, getWorkerPhaseText, type getWorkProgress } from "./helpers";
import { getProductionWares, getWorkProgressSlot, type ProductionWareGroup } from "./production-helpers";
import { ProductionModeChoices } from "./production-mode-choices";
import { getSelectedModeDescription, getShipyardModeChoices, getShipyardRecipeView } from "./production-mode-helpers";

type WorkProgressView = NonNullable<ReturnType<typeof getWorkProgress>>;

interface WorkProgressProps {
  progress: WorkProgressView;
}
const WorkProgress = ({ progress }: WorkProgressProps) => (
  <>
    <small>{progress.text}</small>
    <ProgressBar
      className="settlement-ui__work-progress"
      label={progress.label}
      max={1}
      title={progress.text}
      value={progress.value}
      valueText={progress.text}
    />
  </>
);

interface WorkProgressSlotProps {
  building: SettlementBuildingSummary;
}
/** The bar's line stays reserved for producers, so the window keeps its height between work cycles. */
const WorkProgressSlot = ({ building }: WorkProgressSlotProps) => {
  const { i18n } = useLingui();
  const { className, progress } = getWorkProgressSlot(building, i18n);
  return <div className={className}>{progress && <WorkProgress progress={progress} />}</div>;
};

interface WareGroupIconProps {
  group: ProductionWareGroup;
  ware: string;
}
const WareGroupIcon = ({ group, ware }: WareGroupIconProps) => {
  if (!group.randomTools) return <WareIcon ware={ware} />;
  return (
    <span aria-hidden="true" className="settlement-ui__output-choice-icon settlement-ui__ware-group-random-icon">
      {group.randomTools.map(tool => <WareIcon key={tool} ware={tool} />)}
    </span>
  );
};

interface WareGroupProps {
  group: ProductionWareGroup;
}
const WareGroup = ({ group }: WareGroupProps) => (
  <div aria-label={group.label} className="settlement-ui__ware-group" role="group">
    <h3>{group.heading}</h3>
    <div className="settlement-ui__ware-group-cells">
      {group.cells.map(({ count, label, name, ware }) => (
        <div aria-label={label} data-count={count} data-ware={ware} key={ware} title={label}>
          <WareGroupIcon group={group} ware={ware} />
          <b>{count}</b>
          <small>{name}</small>
        </div>
      ))}
      {group.resourceInput && (
        <div aria-label={group.resourceInput.label} data-production-resource={group.resourceInput.label}>
          <img alt="" decoding="sync" draggable={false} loading="lazy" src={group.resourceInput.source} />
          <small>{group.resourceInput.label}</small>
        </div>
      )}
    </div>
  </div>
);

type ShipyardModeChange = (mode: "boats" | "ships") => boolean | void;

interface ShipyardProductsProps {
  building: SettlementBuildingSummary;
  onChange: ShipyardModeChange;
}
const ShipyardProducts = ({ building, onChange }: ShipyardProductsProps) => {
  const { i18n } = useLingui();
  const mode = building.shipyardMode ?? "boats";
  const choices = getShipyardModeChoices(mode, i18n);
  const recipe = getShipyardRecipeView(building, i18n);
  const helpId = `shipyard-mode-help-${building.id}`;
  return (
    <div aria-label={i18n._(M.details.production.shipyardProduct)} className="settlement-ui__ware-group" role="group">
      <h3>{i18n._(M.details.production.output)}</h3>
      <ProductionModeChoices choices={choices} helpId={helpId} onChange={onChange} />
      <p className="settlement-ui__section-description" id={helpId}>{getSelectedModeDescription(choices)}</p>
      <p className="settlement-ui__shipyard-requirement">{recipe.requirement}</p>
      <p className="settlement-ui__shipyard-progress">{recipe.progress}</p>
      <div aria-label={recipe.progress} className="settlement-ui__shipyard-recipe" role="status">
        {recipe.counts.map(count => (
          <span aria-label={`${displayWareName(count.ware, i18n)} ${count.consumed}/${count.required}`} key={count.ware}>
            <WareIcon ware={count.ware} />
            <b>{count.consumed}/{count.required}</b>
          </span>
        ))}
      </div>
      <p className="settlement-ui__shipyard-stored">{recipe.stored}</p>
      {recipe.riggingIncomplete && <p className="settlement-ui__shipyard-wait" role="status">{recipe.riggingIncomplete}</p>}
    </div>
  );
};

interface ProductionWaresProps {
  building: SettlementBuildingSummary;
  nation?: string;
  onShipyardMode?: ShipyardModeChange;
  showOutput: boolean;
}
/** Input and produced wares in one row: one bubble per side, joined by an arrow. */
const ProductionWares = ({ building, nation, onShipyardMode, showOutput }: ProductionWaresProps) => {
  const { i18n } = useLingui();
  const wares = getProductionWares(building, showOutput, nation, i18n);
  if (!wares) return null;
  return (
    <section aria-label={i18n._(M.details.production.waresAria)} className="settlement-ui__ware-flow">
      {wares.input && <WareGroup group={wares.input} />}
      {(wares.showArrow || (wares.input && onShipyardMode)) && <span aria-hidden="true" className="settlement-ui__ware-flow-arrow">➜</span>}
      {wares.output && <WareGroup group={wares.output} />}
      {onShipyardMode && <ShipyardProducts building={building} onChange={onShipyardMode} />}
    </section>
  );
};

interface ProductionSectionProps {
  building: SettlementBuildingSummary;
  nation?: string;
  onShipyardMode?: ShipyardModeChange;
  showOutput: boolean;
}
/** A producer's activity, live work progress, input stock and produced wares. */
export const ProductionSection = ({ building, nation, onShipyardMode, showOutput }: ProductionSectionProps) => {
  const { i18n } = useLingui();
  const activity = getActivityText(building), workerPhase = getWorkerPhaseText(building, i18n);
  return (
    <>
      {activity && <p className="settlement-ui__section-description">{activity}</p>}
      {workerPhase && <p className="settlement-ui__section-description">{workerPhase}</p>}
      <WorkProgressSlot building={building} />
      <ProductionWares building={building} nation={nation} showOutput={showOutput} onShipyardMode={onShipyardMode} />
    </>
  );
};
