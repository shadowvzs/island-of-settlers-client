import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { GemShop } from "./gem-shop";

/** Mounter for `createLazyReactContent`: the shop loads with React on the window's first open. */
export const createGemShopMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore,
  options: Pick<SettlementUiOptions, "onBuyGemOffer"> & { onPreviewDecoration: (id: string) => void }
) => createComponentMount(GemShop, { options, store, visibility });
