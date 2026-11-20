import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { Talents } from "./talents";

/** Mounter for `createLazyReactContent`: the talent tree loads with React on the window's first open. */
export const createTalentsMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore,
  options: Pick<SettlementUiOptions, "onApplyTalents" | "onResetTalents">
) => createComponentMount(Talents, { options, store, visibility });
