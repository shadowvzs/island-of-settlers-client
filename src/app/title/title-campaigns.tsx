import { CampaignWindowView } from "../settlement-ui/campaign-window/campaign-window-view";
import { FALLBACK_NATION } from "../settlement-ui/campaign-window/constants";
import type { CampaignWindowPort } from "../settlement-ui/campaign-window/types";
import { useCampaignWindowModel } from "../settlement-ui/campaign-window/use-campaign-window";

interface TitleCampaignsProps {
  initialCampaignId?: string;
  port: CampaignWindowPort;
}
/** The campaign window in its start-surface frame (plan §7.4 step 3): one window, two frames (rev G6). */
export const TitleCampaigns = ({ initialCampaignId, port }: TitleCampaignsProps) => {
  const model = useCampaignWindowModel({
    frame: "start", initialCampaignId, nation: FALLBACK_NATION, opened: 1, port, visible: true
  });
  return (
    <div className="campaign-window title-page__campaigns">
      <CampaignWindowView model={model} />
    </div>
  );
};
