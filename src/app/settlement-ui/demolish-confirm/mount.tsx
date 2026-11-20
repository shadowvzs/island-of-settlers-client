import { createComponentMount } from "../../components/react-island";
import type { DemolishConfirmation } from "../demolish-confirmation-helpers";
import { DemolishConfirm } from "./demolish-confirm";

/** Mounter for `createLazyReactContent`: the question loads with React on its first request. */
export const createDemolishConfirmMount = (confirmation: DemolishConfirmation, onDemolish: (uid: number) => void) =>
  createComponentMount(DemolishConfirm, { confirmation, onDemolish });
