import { SettlementIcon } from "../../components/settlement-icon";
import { requestExplorationEntry } from "./entry-store";
import { useExplorationEntryView } from "./use-exploration-entry";
import type { ExplorationEntryView } from "./view-model";

interface ExplorationEntryButtonProps {
  onClick: () => void;
  view: ExplorationEntryView;
}

/** The sibling portrait-corner action: never nested in the quest opener or the level badge. */
export const ExplorationEntryButton = ({ onClick, view }: ExplorationEntryButtonProps) => (
  <button
    aria-label={view.ariaLabel}
    className={view.className}
    data-exploration-entry="true"
    disabled={view.disabled}
    title={view.title}
    type="button"
    onClick={onClick}
  >
    <SettlementIcon name="scout" />
    {view.badge && <span aria-hidden="true" className="player-hud__exploration-badge">{view.badge}</span>}
  </button>
);

/** Connected to the exploration adapter's narrow snapshot; renders nothing when the feature is absent. */
export const ExplorationEntry = () => {
  const view = useExplorationEntryView();
  if (!view) return null;
  return <ExplorationEntryButton view={view} onClick={requestExplorationEntry} />;
};
