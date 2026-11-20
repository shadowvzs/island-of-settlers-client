import { InfoTooltipContent } from "../../components/info-tooltip";
import { useInfoTooltip } from "../../components/use-info-tooltip";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import type { TalentCard, TalentColumn, TalentWindowModel } from "./helpers";
import { useTalents } from "./use-talents";

import "./talents.css";

interface TalentCardViewProps {
  card: TalentCard;
  onRaise: (id: string) => void;
}
/** The whole talent button shows its description on hover or focus and still adds a point on activation. */
const TalentCardView = ({ card, onRaise }: TalentCardViewProps) => {
  const { anchorRef, ...tooltip } = useInfoTooltip<HTMLLIElement>(card.tooltip);
  // Phones have no hover: tapping a locked talent pins its description, which says why.
  const raise = () => {
    onRaise(card.id);
    if (!card.canRaise) tooltip.onClick();
  };
  return (
    <li className={card.className} data-talent={card.id} ref={anchorRef}>
      <button
        aria-describedby={tooltip.id}
        aria-disabled={!card.canRaise}
        aria-label={card.actionLabel}
        className="talents__raise"
        type="button"
        onBlur={tooltip.onBlur}
        onClick={raise}
        onFocus={tooltip.onFocus}
        onKeyDown={tooltip.onKeyDown}
        onMouseEnter={tooltip.onMouseEnter}
        onMouseLeave={tooltip.onMouseLeave}
      >
        <img
          alt=""
          className="talents__icon"
          data-building-icon={card.icon.buildingType}
          draggable={false}
          src={card.icon.source}
        />
        <span className="talents__name">{card.name}</span>
        <span className="talents__rank">{card.rankText}</span>
        {card.lockText && <span className="talents__lock">{card.lockText}</span>}
      </button>
      <InfoTooltipContent {...tooltip} lines={card.tooltip} />
    </li>
  );
};

interface BranchColumnProps {
  column: TalentColumn;
  onRaise: (id: string) => void;
}
/** A branch tree: tier rows from top (open) to bottom (capstone), joined by the branch's spine. */
const BranchColumn = ({ column, onRaise }: BranchColumnProps) => (
  <section aria-label={column.label} className="talents__branch" data-branch={column.branch}>
    <h3 className="talents__branch-title">{column.label}</h3>
    <ol className="talents__tiers">
      {column.tiers.map(tier => (
        <li className="talents__tier" data-tier={tier.tier} key={tier.tier}>
          <span className="talents__tier-label">{tier.label}</span>
          <ul className="talents__row">
            {tier.cards.map(card => <TalentCardView card={card} key={card.id} onRaise={onRaise} />)}
          </ul>
        </li>
      ))}
    </ol>
  </section>
);

interface TalentsViewProps {
  model: TalentWindowModel;
  status: string;
  onApply: () => void;
  onRaise: (id: string) => void;
  onReset: () => void;
}
const TalentsView = ({ model, status, onApply, onRaise, onReset }: TalentsViewProps) => (
  <>
    <div className="talents__branches">
      {model.columns.map(column => <BranchColumn column={column} key={column.branch} onRaise={onRaise} />)}
    </div>
    <div className="talents__actions">
      <p className="talents__points">{model.pointsText}</p>
      <button
        aria-disabled={model.reset.disabled}
        className="settlement-ui__button talents__reset"
        title={model.reset.title}
        type="button"
        onClick={onReset}
      >
        {model.reset.label}
      </button>
      <button
        aria-disabled={model.applyDisabled}
        className="settlement-ui__button talents__apply"
        type="button"
        onClick={onApply}
      >
        {model.applyLabel}
      </button>
    </div>
    <small className="talents__status" role="status">{status}</small>
  </>
);

interface TalentsProps {
  options: Pick<SettlementUiOptions, "onApplyTalents" | "onResetTalents">;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/** Player talents (TALENT-01): three branch trees, pending points, Apply and Reset. */
export const Talents = ({ options, store, visibility }: TalentsProps) => (
  <TalentsView {...useTalents(store, visibility, options)} />
);
