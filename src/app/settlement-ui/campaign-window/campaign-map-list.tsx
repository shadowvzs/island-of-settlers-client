import { SettlementIcon } from "../../components/settlement-icon";
import type { CampaignMapRow } from "./helpers";

interface CampaignMapListProps {
  label: string;
  rows: readonly CampaignMapRow[];
  onSelect: (id: string) => void;
}
/**
 * The campaign's maps in graph order; locked and closed maps stay selectable (dimmed, names shown) so their
 * requirements and the reason can be read.
 */
export const CampaignMapList = ({ label, rows, onSelect }: CampaignMapListProps) => (
  <ol aria-label={label} className="campaign-window__maps">
    {rows.map(row => (
      <li key={row.id}>
        <button
          aria-pressed={row.selected}
          className={row.className}
          data-campaign-map={row.id}
          data-status={row.node}
          title={row.statusText}
          type="button"
          onClick={() => onSelect(row.id)}
        >
          <span aria-label={row.statusText} className="campaign-window__lock" role="img">
            <SettlementIcon name={row.icon} />
          </span>
          <span className="campaign-window__map-text">
            <span className="campaign-window__map-name">{row.name}</span>
            {row.detail && <span className="campaign-window__map-detail">{row.detail}</span>}
          </span>
        </button>
      </li>
    ))}
  </ol>
);
