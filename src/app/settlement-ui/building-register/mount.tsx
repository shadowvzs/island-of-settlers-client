import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { BuildingRegister } from "./building-register";
import type { BuildingRegisterActions } from "./use-building-register";

/** Mounter for `createLazyReactContent`: the register loads with React on the window's first open. */
export const createBuildingRegisterMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, actions: BuildingRegisterActions
) => createComponentMount(BuildingRegister, { actions, store, visibility });
