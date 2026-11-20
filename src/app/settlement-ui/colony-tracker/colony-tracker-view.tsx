import { useLingui } from "@lingui/react";
import { createPortal } from "react-dom";

import { IconButton } from "../../components/icon-button";
import { Inventory } from "../../components/inventory";
import { ProgressBar } from "../../components/progress-bar";
import { SettlementIcon } from "../../components/settlement-icon";
import { ArtImage } from "../art-image";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { ColonyList } from "./colony-list-view";
import type { ExpeditionCardView } from "./helpers";
import { type ColonyTrackerContext, type ColonyTrackerView, useColonyTracker } from "./use-colony-tracker";

interface HandleProps {
  header: ColonyTrackerView["header"];
  onToggle: () => void;
}
/** Drag icon, heading and minimise / restore button inside the drag handle (it ignores button presses). */
export const TrackerHandle = ({ header, onToggle }: HandleProps) => (
  <>
    <SettlementIcon name="drag" />
    <span className="colony-tracker__handle-content">
      <span>{header.heading}</span>
      <button
        aria-expanded={header.expanded}
        aria-label={header.toggle}
        className="settlement-ui__button colony-tracker__toggle"
        title={header.toggle}
        type="button"
        onClick={onToggle}
      >
        <SettlementIcon name={header.icon} />
      </button>
    </span>
  </>
);

interface CardDetailsProps {
  details: NonNullable<ExpeditionCardView["details"]>;
  onCancel: () => void;
}
const CardDetails = ({ details, onCancel }: CardDetailsProps) => {
  const { i18n } = useLingui();
  return (
  <div className="colony-tracker__details">
    <div className="colony-tracker__troops">
      {details.troops.map(troop => (
        <span key={troop.type} title={troop.title}>
          <img alt="" draggable={false} src={troop.icon} />
          <b>{troop.count}</b>
        </span>
      ))}
    </div>
    {details.supplies && <Inventory heading={details.supplies.heading} inventory={details.supplies.goods} />}
    {details.commander && <p className="settlement-ui__section-description">{details.commander}</p>}
    {details.note && <p className="settlement-ui__section-description">{details.note}</p>}
    {details.cancel && (
      <IconButton caption={i18n._(M.colony.cancelExpedition)} icon="cancel"
        label={i18n._(M.colony.cancelExpedition)} onClick={onCancel} />
    )}
  </div>
  );
};

interface ExpeditionCardProps {
  card: ExpeditionCardView;
  onCancel: (id: number) => void;
  onToggle: (id: number) => void;
}
const ExpeditionCard = ({ card, onCancel, onToggle }: ExpeditionCardProps) => (
  <article className={card.className} data-colony-expedition={card.id}>
    <button aria-label={card.label} className="colony-tracker__summary" type="button" onClick={() => onToggle(card.id)}>
      <ArtImage art={card.shipArt} />
      <span className="colony-tracker__text">
        <strong><ArtImage art={card.art} />{card.title}</strong>
        <small>{card.status}</small>
      </span>
      {card.countdown && <time className="colony-tracker__countdown">{card.countdown}</time>}
    </button>
    {card.progress && (
      <ProgressBar className="colony-tracker__progress" max={card.progress.max} value={card.progress.value} />
    )}
    <div>{card.details && <CardDetails details={card.details} onCancel={() => onCancel(card.id)} />}</div>
  </article>
);

interface ColonyTrackerBodyProps {
  view: ColonyTrackerView;
}
/** Expedition cards and the colony list (server-renderable: no portal). */
export const ColonyTrackerBody = ({ view }: ColonyTrackerBodyProps) => (
  <>
    <div>
      {view.cards.map(card => (
        <ExpeditionCard card={card} key={card.id} onCancel={view.onCancel} onToggle={view.onToggleCard} />
      ))}
    </div>
    <ColonyList rows={view.rows} />
  </>
);

interface ColonyTrackerProps {
  context: ColonyTrackerContext;
}
/** Expedition cards and the colony list; the handle's icon, heading and toggle render into the DOM drag handle. */
export const ColonyTracker = ({ context }: ColonyTrackerProps) => {
  const view = useColonyTracker(context);
  return (
    <>
      {createPortal(<TrackerHandle header={view.header} onToggle={view.onToggleCollapsed} />, context.handle)}
      <ColonyTrackerBody view={view} />
    </>
  );
};
