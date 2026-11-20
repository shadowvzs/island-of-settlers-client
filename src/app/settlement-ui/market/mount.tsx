import type { MarketControls } from "../../../shared/trade/market";
import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { PlayerMarket } from "./market";

import "./market.css";

/** Mounter for the window's lazy React chunk. */
export const createMarketMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, market?: MarketControls
) => createComponentMount(PlayerMarket, { market, store, visibility });
