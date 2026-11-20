import { useLingui } from "@lingui/react";

import { useExternalStore } from "../components/external-store";
import { IconButton } from "../components/icon-button";
import type { ExternalStore } from "../components/ui-store";
import type { ObservationView } from "./helpers";
import { getUnitReasonText } from "./unit-reason-text";

export interface ObservationContentProps {
  store: ExternalStore<ObservationView>;
  onFollow: () => void;
  onRoute: () => void;
  onStop: () => void;
}
/** Observe window body: the subject's status line, its decision reason and the Follow / Stop / Route toggles. */
export const ObservationContent = ({ store, onFollow, onRoute, onStop }: ObservationContentProps) => {
  const { i18n } = useLingui();
  const { detail, followDisabled, reason, routePressed, routeVisible, stopDisabled } = useExternalStore(store);
  const reasonText = reason && getUnitReasonText(i18n, reason);
  return (
    <>
      <p role="status">{detail}</p>
      {reasonText && <p className="settlement-ui__section-description">{reasonText}</p>}
      <div className="camera-control-row">
        <IconButton caption="Follow" disabled={followDisabled} icon="map" label="Follow this worker or ship"
          onClick={onFollow} />
        <IconButton caption="Stop" disabled={stopDisabled} icon="cancel" label="Stop following" onClick={onStop} />
        {routeVisible && (
          <IconButton caption="Route" icon="map" label="Show the selected worker or ship's upcoming route"
            pressed={routePressed} onClick={onRoute} />
        )}
      </div>
    </>
  );
};
