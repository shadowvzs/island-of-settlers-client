import { mountReactIsland } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { TradeOffice } from "./trade-office";
import type { SettlementTradeOffice } from "./types";

import "./trade-office.css";

/** Mounter for `createLazyReactContent`: the trade office loads with React on the window's first open. */
export const createTradeOfficeMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, trade: SettlementTradeOffice
) => (content: HTMLElement) =>
  mountReactIsland(content, <TradeOffice store={store} trade={trade} visibility={visibility} />);
