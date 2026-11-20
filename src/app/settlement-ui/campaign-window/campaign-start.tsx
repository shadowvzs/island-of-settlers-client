import { IconButton } from "../../components/icon-button";
import type { CampaignStartModel } from "./start-frame-helpers";

interface CampaignStartProps {
  label: string;
  model: CampaignStartModel;
  onStart: () => void;
}
/** The start-surface frame's panel (GS3b): why the map cannot start, or the ready line, and Start map. */
export const CampaignStart = ({ label, model, onStart }: CampaignStartProps) => (
  <section aria-label={label} className="campaign-window__departure">
    <p className="campaign-window__hint">{model.hint}</p>
    <IconButton
      className="settlement-ui__button--primary"
      data={{ "data-campaign-start": "" }}
      disabled={model.disabled}
      icon="campaign"
      label={label}
      onClick={onStart}
    />
  </section>
);
