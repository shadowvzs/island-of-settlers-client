import type { MarketControls } from "../../../shared/trade/market";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { PlayerMarketView } from "./market-view";
import { useMarket } from "./use-market";

interface PlayerMarketProps {
  market?: MarketControls;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/** The Player Market's React root: all state comes from the hook, the view only renders it. */
export const PlayerMarket = ({ market, store, visibility }: PlayerMarketProps) => (
  <PlayerMarketView {...useMarket(store, visibility, market)} />
);
