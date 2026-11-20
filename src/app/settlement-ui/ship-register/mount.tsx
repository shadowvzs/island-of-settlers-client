import type { ExternalStore } from "../../components/external-store";
import { createComponentMount } from "../../components/react-island";
import type { ShipRegisterState } from "./helpers";
import { ShipRegister } from "./ship-register";
import type { ShipRegisterActions } from "./ship-register-window";

/** Mounter for `createLazyReactContent`: the register loads with React on its first open. */
export const createShipRegisterMount = (store: ExternalStore<ShipRegisterState>, actions: ShipRegisterActions) =>
  createComponentMount(ShipRegister, { actions, store });
