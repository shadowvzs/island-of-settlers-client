import { SettlementIcon } from "../../components/settlement-icon";
import { WareIcon } from "../../components/ware-icon";
import { ArtImage } from "../art-image";
import type { PlannerIslandCardView } from "./helpers";
import { navigatePlannerChoices, PlannerChoice } from "./planner-choice";

interface IslandChoicesProps {
  cards: readonly PlannerIslandCardView[];
  label: string;
  onChoose: (id: number) => void;
}

/** Climate artwork is decorative; the full island, difficulty and resource description stays accessible. */
export const IslandChoices = ({ cards, label, onChoose }: IslandChoicesProps) => (
  <div aria-label={label} className="colony-planner__islands" role="radiogroup" tabIndex={-1} onKeyDown={navigatePlannerChoices}>
    {cards.map(card => (
      <PlannerChoice checked={card.checked} className="settlement-ui__button colony-planner__island"
        data={{ "data-colony-island": card.id, "data-island-climate": card.climate }} disabled={card.disabled}
        key={card.id} label={card.title} lines={card.tooltipLines} onChoose={() => onChoose(card.id)}>
        <ArtImage art={card.art} />
        <span aria-hidden="true" className="colony-planner__difficulty" title={card.level}>
          <SettlementIcon name="skull" /><b>{card.difficultyNumber}</b>
        </span>
        <span aria-hidden="true" className="colony-planner__resources">
          {card.resources.map(resource => <WareIcon key={resource.ware} title={resource.title} ware={resource.ware} />)}
        </span>
        <span className="colony-planner__accessible-text">{card.name} · {card.level} · {card.detail}</span>
      </PlannerChoice>
    ))}
  </div>
);
