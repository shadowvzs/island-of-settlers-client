import { WareIcon } from "../../components/ware-icon";
import type { TradeLotView } from "./helpers";

interface TradeLotBadgeProps {
  lot: TradeLotView;
}
/** Amount + cached ware icon (its title is the ware name); the full lot text is the accessible name. */
export const TradeLotBadge = ({ lot }: TradeLotBadgeProps) => (
  <span aria-label={lot.text} className="trade-office__lot" data-ware={lot.ware} role="img">
    <b>{lot.amount}</b>
    <WareIcon ware={lot.ware} />
  </span>
);

interface TradePairProps {
  give: TradeLotView;
  want: TradeLotView;
}
/** "<give> → <want>" from the player's side of the trade. */
export const TradePair = ({ give, want }: TradePairProps) => (
  <span className="trade-office__pair">
    <TradeLotBadge lot={give} />
    <span aria-hidden="true" className="trade-office__arrow">→</span>
    <TradeLotBadge lot={want} />
  </span>
);
