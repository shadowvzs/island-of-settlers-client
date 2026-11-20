import { createComponentMount } from "../../components/react-island";
import type { SettlementPopupStore } from "../settlement-popup";
import { SettlementPopup } from "./settlement-popup";

/** Mounter for `createLazyReactContent`: the popup card loads with React on the first popup. */
export const createPopupMount = (store: SettlementPopupStore, close: () => void) => createComponentMount(SettlementPopup, { store, onClose: close });
