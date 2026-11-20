import { BuildingIcon } from "../../components/building-icon";
import { useInfoTooltip } from "../../components/use-info-tooltip";
import { WareIcon } from "../../components/ware-icon";
import type { BuildingCard } from "./build-helpers";

import "../../components/info-tooltip.css";
import "./building-card.css";

interface BuildingCardButtonProps {
  card: BuildingCard;
  onPickCard: (card: BuildingCard) => void;
}

/** Hover/focus shows the receipt; touch keeps it visible while preserving the placement action. */
export const BuildingCardButton = ({ card, onPickCard }: BuildingCardButtonProps) => {
  const { anchorRef, tooltipRef, ...tooltip } = useInfoTooltip<HTMLButtonElement>(card);
  return (
    <>
      <button
        aria-describedby={tooltip.id}
        aria-disabled={card.locked}
        aria-pressed={card.pressed}
        className={card.className}
        data-building={card.id}
        hidden={card.hidden}
        ref={anchorRef}
        type="button"
        onBlur={tooltip.onBlur}
        onClick={() => { tooltip.onClick(); onPickCard(card); }}
        onFocus={tooltip.onFocus}
        onKeyDown={tooltip.onKeyDown}
        onMouseEnter={tooltip.onMouseEnter}
        onMouseLeave={tooltip.onMouseLeave}
      >
        <BuildingIcon type={card.id} />
        <span className="settlement-ui__build-card-name">{card.name}</span>
        <small>{card.size}</small>
        {card.lockText && <span className="settlement-ui__card-lock">{card.lockText}</span>}
      </button>
      <div
        className="info-tooltip__content building-card__tooltip"
        hidden={card.hidden || !tooltip.shown}
        id={tooltip.id}
        ref={tooltipRef}
        role="tooltip"
        style={tooltip.position}
      >
        <strong>{card.name}</strong>
        <p>{card.description}</p>
        <ul className="building-card__materials">
          {card.materials.map(material => (
            <li key={material.ware}>
              <WareIcon title={material.name} ware={material.ware} />
              <span>{material.count} × {material.name}</span>
            </li>
          ))}
        </ul>
        {card.lockText && <p>{card.title}</p>}
      </div>
    </>
  );
};
