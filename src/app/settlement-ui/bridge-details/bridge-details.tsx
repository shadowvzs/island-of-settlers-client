import { IconButton } from "../../components/icon-button";
import { BuildingFooter } from "../building-details/building-footer";
import { ConstructionSection } from "../building-details/construction-section";
import { UpgradeConfirmation } from "../building-details/upgrade-confirmation";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import type { BridgeDetailsView, BridgeRemovalView } from "./helpers";
import { useBridgeDetails } from "./use-bridge-details";

import "./bridge-details.css";

interface RemovalQuestionProps {
  id: string;
  removal: BridgeRemovalView;
  onKeep: () => void;
  onRemove: () => void;
}
/** In-panel question before a removal, in the demolish confirmation's visual language. */
const RemovalQuestion = ({ id, removal, onKeep, onRemove }: RemovalQuestionProps) => (
  <section className="settlement-ui__bridge-removal" data-bridge-remove-question={id} role="alertdialog">
    <p className="settlement-ui__demolish-question"><strong>{removal.question}</strong></p>
    <p>{removal.consequence}</p>
    <div className="settlement-ui__demolish-choices">
      <button aria-label={removal.keepLabel} className="settlement-ui__button settlement-ui__demolish-choice"
        data-bridge-remove-no={id} type="button" onClick={onKeep}>
        {removal.keep}
      </button>
      <button aria-label={removal.confirmLabel}
        className="settlement-ui__button settlement-ui__demolish-choice settlement-ui__demolish-choice--danger"
        data-bridge-remove-yes={id} type="button" onClick={onRemove}>
        {removal.confirm}
      </button>
    </div>
  </section>
);

interface BridgeDetailsViewProps {
  asking: boolean;
  id: string;
  view: BridgeDetailsView;
  visible: boolean;
  onAskRemoval: () => void;
  onKeep: () => void;
  onRemove: () => void;
  onUpgrade: (cancel: boolean) => boolean | void;
}
const BridgeDetailsBody = ({
  asking, id, view, visible, onAskRemoval, onKeep, onRemove, onUpgrade
}: BridgeDetailsViewProps) => (
  <>
    <div className="settlement-ui__building-details-body">
      <div className="settlement-ui__building-details-heading settlement-ui__bridge-subject">
        <img alt="" src={view.image} />
        <div>
          <p aria-label={view.levelAria} className="settlement-ui__building-level" data-bridge-level={view.level.value}>
            <strong>{view.level.text}</strong>
          </p>
          <p>{view.span}</p>
          {view.removalStatus && <p data-bridge-removal-status={id}>{view.removalStatus}</p>}
        </div>
      </div>
      {view.construction && <ConstructionSection details={view.construction} />}
      {asking && <RemovalQuestion id={id} removal={view.removal} onKeep={onKeep} onRemove={onRemove} />}
    </div>
    <BuildingFooter>
      <div className="settlement-ui__building-final-actions">
        <IconButton caption={view.removal.caption} data={{ "data-bridge-remove": id }}
          disabled={view.removal.disabled} icon="demolish" label={view.removal.label} pressed={asking}
          onClick={onAskRemoval} />
        {view.upgrade && <UpgradeConfirmation id={id} subject="bridge-upgrade" view={view.upgrade} visible={visible}
          onUpgrade={onUpgrade} />}
      </div>
    </BuildingFooter>
  </>
);

interface BridgeDetailsProps {
  options: SettlementUiOptions;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/** Bridge panel content: level and span, construction progress, Remove and Upgrade (building-details style). */
export const BridgeDetails = ({ options, store, visibility }: BridgeDetailsProps) => {
  const { asking, bridge, view, visible, askRemoval, keep } = useBridgeDetails(store, visibility);
  if (!bridge || !view) return null;
  const id = Number(bridge.id);
  return (
    <BridgeDetailsBody asking={asking} id={bridge.id} view={view} visible={visible} onAskRemoval={askRemoval}
      onKeep={keep} onRemove={() => { if (options.onRemoveBridge?.(id)) keep(); }}
      onUpgrade={cancel => options.onBridgeUpgrade?.(id, cancel)} />
  );
};
