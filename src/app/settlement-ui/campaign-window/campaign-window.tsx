import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { CampaignWindowView } from "./campaign-window-view";
import type { CampaignWindowPort } from "./types";
import { useCampaignWindow } from "./use-campaign-window";

interface CampaignWindowProps {
  port: CampaignWindowPort;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/**
 * Campaign window (C8, BR4): the maps with their state as a list or as the compact path graph, what leaves home
 * storage, Set sail.
 */
export const CampaignWindow = ({ port, store, visibility }: CampaignWindowProps) => {
  const model = useCampaignWindow(store, visibility, port);
  return <CampaignWindowView model={model} />;
};
