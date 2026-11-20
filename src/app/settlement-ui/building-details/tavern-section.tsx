import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { MilitaryTroopType, OrdinaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { CountStepper } from "../../components/count-stepper";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementTavernSummary } from "../types";
import {
  getTavernIngredients, getTavernOrder, getTavernSchedule, getTavernTroops, stepTavernCount,
  type TavernDraft, type TavernIngredient, type TavernScheduleEntry
} from "./tavern-helpers";
import { WorkerPortrait } from "./worker-portrait";

interface TroopChoiceProps {
  nation: string;
  selected: OrdinaryTroopType;
  onSelect: (type: OrdinaryTroopType) => void;
}
const TroopChoice = ({ nation, selected, onSelect }: TroopChoiceProps) => {
  const { i18n } = useLingui();
  return (
  <div className="settlement-ui__tavern-troops">
    {getTavernTroops(nation, selected, i18n).map(troop => (
      <button
        aria-label={troop.label}
        aria-pressed={troop.pressed}
        data-tavern-troop={troop.type}
        key={troop.type}
        title={troop.label}
        type="button"
        onClick={() => onSelect(troop.type)}
      >
        <img alt="" draggable={false} src={troop.icon} />
        <span>{troop.name}</span>
      </button>
    ))}
  </div>
  );
};

interface IngredientIconProps {
  ware: string | null;
}
const IngredientIcon = ({ ware }: IngredientIconProps) => {
  if (ware) return <WareIcon ware={ware} />;
  return <WorkerPortrait job="Carrier" />;
};

interface IngredientViewProps {
  ingredient: TavernIngredient;
}
const IngredientView = ({ ingredient }: IngredientViewProps) => (
  <div className="settlement-ui__tavern-ingredient" data-enough={ingredient.enough} title={ingredient.title}>
    <IngredientIcon ware={ingredient.ware} />
    <small>{ingredient.amount}</small>
  </div>
);

interface OrderRowProps {
  draft: TavernDraft;
  nation: string;
  onCount: (count: number) => void;
  onOrder: () => void;
}
const OrderRow = ({ draft, nation, onCount, onOrder }: OrderRowProps) => {
  const { i18n } = useLingui();
  const order = getTavernOrder(draft, nation, i18n);
  return (
    <div className="settlement-ui__tavern-order">
      <CountStepper
        count={order.count}
        countLabel={i18n._(M.details.tavern.recruitsToOrder)}
        decreaseDisabled={order.decreaseDisabled}
        decreaseLabel={i18n._(M.details.tavern.oneFewer)}
        increaseDisabled={order.increaseDisabled}
        increaseLabel={i18n._(M.details.tavern.oneMore)}
        onDecrease={() => onCount(stepTavernCount(draft.count, -1))}
        onIncrease={() => onCount(stepTavernCount(draft.count, 1))}
      />
      <button
        aria-label={order.submitLabel}
        className="settlement-ui__button settlement-ui__tavern-submit"
        data-tavern-order={order.type}
        title={order.submitLabel}
        type="button"
        onClick={onOrder}
      >
        {order.submit}
      </button>
    </div>
  );
};

interface ScheduleRowProps {
  entry: TavernScheduleEntry;
  current?: boolean;
}
const ScheduleRow = ({ entry, current = false }: ScheduleRowProps) => {
  let currentAttribute: "true" | undefined;
  let entryAttribute: MilitaryTroopType | undefined;
  if (current) currentAttribute = "true";
  else entryAttribute = entry.type;
  return (
    <li
      className="settlement-ui__tavern-schedule-row"
      data-tavern-schedule-current={currentAttribute}
      data-tavern-schedule-entry={entryAttribute}
    >
      <img alt="" draggable={false} src={entry.portrait} />
      <span>{entry.label}</span>
    </li>
  );
};

interface ScheduleBoxProps {
  nation: string;
  summary: SettlementTavernSummary;
}
/** The recruiting queue: the active recruit and every batch scheduled behind it. */
const ScheduleBox = ({ nation, summary }: ScheduleBoxProps) => {
  const { i18n } = useLingui();
  const schedule = getTavernSchedule(summary, nation, i18n);
  let body = <p>{i18n._(M.details.tavern.scheduleEmpty)}</p>;
  if (schedule.current || schedule.waiting.length > 0) body = (
    <ol>
      {schedule.current && <ScheduleRow current entry={schedule.current} />}
      {schedule.waiting.map(entry => <ScheduleRow entry={entry} key={entry.key} />)}
    </ol>
  );
  return (
    <section
      aria-label={i18n._(M.details.tavern.scheduleTitle)}
      className="settlement-ui__tavern-schedule"
      data-tavern-schedule=""
    >
      <header>
        <h4>{i18n._(M.details.tavern.scheduleTitle)}</h4>
        {schedule.total > 0 && (
          <span>{translateMessage(i18n, M.details.tavern.scheduledTotal, { count: schedule.total })}</span>
        )}
      </header>
      {body}
    </section>
  );
};

interface TavernSectionProps {
  draft: TavernDraft;
  nation: string;
  resources?: Readonly<Record<string, number>>;
  summary: SettlementTavernSummary;
  onDraft: (draft: TavernDraft) => void;
  onRecruit?: (type: MilitaryTroopType, count: number) => void;
}
/** Tavern recruiting: troop type, its ingredients, the order count and the schedule. */
export const TavernSection = ({ draft, nation, resources, summary, onDraft, onRecruit }: TavernSectionProps) => {
  const { i18n } = useLingui();
  const ingredients = useMemo(() => getTavernIngredients(draft.type, summary, resources, i18n),
    [draft.type, i18n, resources, summary]);
  return (
    <section aria-label={i18n._(M.details.tavern.aria)} className="settlement-ui__tavern">
      <TroopChoice nation={nation} selected={draft.type} onSelect={type => onDraft({ ...draft, type })} />
      <div aria-label={i18n._(M.details.tavern.ingredientsAria)} className="settlement-ui__tavern-recipe">
        {ingredients.map(ingredient => <IngredientView ingredient={ingredient} key={ingredient.key} />)}
      </div>
      <OrderRow
        draft={draft}
        nation={nation}
        onCount={count => onDraft({ ...draft, count })}
        onOrder={() => onRecruit?.(draft.type, draft.count)}
      />
      <ScheduleBox nation={nation} summary={summary} />
      <p className="settlement-ui__section-description">{i18n._(M.details.tavern.hint)}</p>
    </section>
  );
};
