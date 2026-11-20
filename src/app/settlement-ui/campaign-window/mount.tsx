import { createComponentMount } from "../../components/react-island";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { CampaignWindow } from "./campaign-window";
import type { CampaignWindowPort } from "./types";

/** Mounter for `createLazyReactContent`: the campaign window loads with React on its first open. */
export const createCampaignWindowMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, port: CampaignWindowPort
) => createComponentMount(CampaignWindow, { port, store, visibility });
