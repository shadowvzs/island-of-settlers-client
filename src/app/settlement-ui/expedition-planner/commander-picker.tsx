import { useLingui } from "@lingui/react";

import { SettlementIcon } from "../../components/settlement-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { RankChevrons } from "../rank-chevrons";
import type { PlannerCommanderCard } from "./helpers";
import { navigatePlannerChoices, PlannerChoice } from "./planner-choice";

interface CommanderCardProps {
  card: PlannerCommanderCard;
  onChoose: (id: string | null) => void;
}
const CommanderCard = ({ card, onChoose }: CommanderCardProps) => (
  <PlannerChoice
    checked={card.checked}
    className="settlement-ui__button colony-planner__commander"
    data={{ "data-commander-card": card.id || "none" }}
    disabled={card.disabled}
    label={card.aria}
    lines={card.tooltipLines}
    onChoose={() => onChoose(card.id || null)}
  >
    {card.portrait && <span className="settlement-ui__soldier-portrait colony-planner__commander-portrait">
      <img alt="" draggable={false} src={card.portrait} />
      <RankChevrons level={card.rank ?? 1} />
    </span>}
    {!card.portrait && <SettlementIcon name="cancel" />}
    <span className="colony-planner__accessible-text">{card.name} · {card.level} · {card.detail} · {card.status}</span>
  </PlannerChoice>
);

interface CommanderPickerProps {
  cards: readonly PlannerCommanderCard[];
  heading: string;
  summary: string;
  onChoose: (id: string | null) => void;
}
/** Optional single-select commander cards; `No commander` is always the safe initial choice. */
export const CommanderPicker = ({ cards, heading, onChoose, summary }: CommanderPickerProps) => {
  const { i18n } = useLingui();
  return (
    <section aria-label={i18n._(M.planner.commanderAria)} className="colony-planner__commanders">
      <b>{heading}</b>
      <div aria-label={i18n._(M.planner.commanderAria)} role="radiogroup" tabIndex={-1} onKeyDown={navigatePlannerChoices}>
        {cards.map(card => <CommanderCard card={card} key={card.id || "none"} onChoose={onChoose} />)}
      </div>
      <small>{summary}</small>
      <small>{i18n._(M.planner.commanderDeck)}</small>
    </section>
  );
};
