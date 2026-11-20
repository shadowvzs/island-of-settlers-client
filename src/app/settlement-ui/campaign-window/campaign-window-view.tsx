import { IconButton } from "../../components/icon-button";
import { Select } from "../../components/select";
import { CampaignDeparture } from "./campaign-departure";
import { CampaignMapList } from "./campaign-map-list";
import { CampaignPathGraph } from "./campaign-path-graph";
import { CampaignStart } from "./campaign-start";
import type { CampaignWindowModel } from "./use-campaign-window";

import "./campaign-window.css";

interface CampaignWindowViewProps {
  model: CampaignWindowModel;
}
/**
 * The campaign window's content in either frame (C8, BR4, GS3b): the maps with their state as a list or as the
 * compact path graph, then what leaves home storage and Set sail (home) or the start panel (title page).
 */
export const CampaignWindowView = ({ model }: CampaignWindowViewProps) => {
  if (model.loading) return <p className="campaign-window__note">{model.text.loading}</p>;
  if (!model.hasMap) return <p className="campaign-window__note">{model.text.empty}</p>;
  return (
    <>
      <div className="campaign-window__toolbar">
        {model.campaigns.length > 1 && (
          <Select
            choices={model.campaigns}
            label={model.text.campaign}
            selected={model.campaignId}
            onChange={model.onCampaign}
          />
        )}
        <IconButton
          className="campaign-window__graph-toggle"
          data={{ "data-campaign-graph": "" }}
          icon="map"
          label={model.text.paths}
          pressed={model.graphShown}
          onClick={model.onToggleGraph}
        />
      </div>
      {model.completedNote && <p className="campaign-window__note">{model.completedNote}</p>}
      {model.graph && <CampaignPathGraph graph={model.graph} label={model.text.paths} onSelect={model.onMap} />}
      {!model.graph && <CampaignMapList label={model.text.maps} rows={model.rows} onSelect={model.onMap} />}
      {model.depart && (
        <CampaignDeparture
          cargoLabel={model.text.cargo}
          departLabel={model.text.depart}
          model={model.depart}
          onDepart={model.onDepart}
        />
      )}
      {model.start && <CampaignStart label={model.text.start} model={model.start} onStart={model.onDepart} />}
      <p aria-live="polite" className="campaign-window__status" role="status">{model.status}</p>
    </>
  );
};
