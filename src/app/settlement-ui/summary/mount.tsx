import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { SettlementSummary } from "./settlement-summary";

/** Mounter for `createLazyReactContent`: the overview loads with React on the window's first open. */
export const createSummaryMount = (store: SettlementUiStore, visibility: SettlementWindowVisibilityStore) =>
  createComponentMount(SettlementSummary, { store, visibility });
