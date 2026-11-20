import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { BridgeDetails } from "./bridge-details";

/** Mounter for `createLazyReactContent`: the bridge panel loads with React on its first open. */
export const createBridgeDetailsMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, options: SettlementUiOptions
) => createComponentMount(BridgeDetails, { options, store, visibility });
