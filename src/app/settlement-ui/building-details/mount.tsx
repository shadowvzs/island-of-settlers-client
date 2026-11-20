import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { BuildingDetails } from "./building-details";

/** Mounter for `createLazyReactContent`: the sections load with React on the window's first open. */
export const createBuildingDetailsMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, options: SettlementUiOptions
) => createComponentMount(BuildingDetails, { options, store, visibility });
