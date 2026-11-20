import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { PlaceSide, PlaceSideView } from "./place-offer-helpers";
import { TradeLotBadge } from "./trade-lot";
import type { PlaceOfferState } from "./use-place-offer";
import { WarePicker } from "./ware-picker";

interface SideButtonProps {
  view: PlaceSideView;
  onToggle: (side: PlaceSide) => void;
}
const SideButton = ({ view, onToggle }: SideButtonProps) => (
  <button
    aria-controls={view.pickerId}
    aria-expanded={view.open}
    aria-label={view.label}
    className="settlement-ui__card trade-office__side"
    data-side={view.side}
    id={view.buttonId}
    type="button"
    onClick={() => onToggle(view.side)}
  >
    <strong>{view.heading}</strong>
    {view.lot && <TradeLotBadge lot={view.lot} />}
    {view.empty && <small>{view.empty}</small>}
  </button>
);

interface PlaceOfferPanelProps {
  countText: string;
  place: PlaceOfferState;
  onCancel: () => void;
  onConfirm: () => void;
}
/** "I give" / "I want" with their pickers, the fair-value estimate, the offer count and ✓ / ✗. */
export const PlaceOfferPanel = ({ countText, place, onCancel, onConfirm }: PlaceOfferPanelProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.trade.placeOffer)} className="trade-office__place">
    <div className="trade-office__sides">
      {place.sides.map(view => <SideButton key={view.side} view={view} onToggle={place.onToggleSide} />)}
    </div>
    {place.picker && (
      <WarePicker
        picker={place.picker}
        onAmount={place.onAmount}
        onDone={() => place.closePicker(true)}
        onPick={place.onPickWare}
      />
    )}
    <p className="trade-office__estimate" data-estimate={place.estimate.tone} role="status">
      {place.estimate.text}
    </p>
    <p className="trade-office__count">{countText}</p>
    <div className="trade-office__confirm">
      <IconButton
        caption={i18n._(M.trade.place)}
        disabled={place.confirmDisabled}
        icon="apply"
        label={i18n._(M.trade.placeNow)}
        onClick={onConfirm}
      />
      <IconButton caption={i18n._(M.common.discard)} icon="cancel" label={i18n._(M.trade.discardOffer)}
        onClick={onCancel} />
    </div>
  </section>
  );
};
