import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { IconButton } from "../../components/icon-button";
import { isShallowEqual } from "../../components/ui-store";
import { useStoreSelector } from "../../components/use-store-selector";
import type { SettlementUiStore } from "../ui-store";
import { getPlacementStrip, selectPlacement } from "./helpers";
import { HUD_MESSAGES } from "./messages";

const usePlacementStrip = (store: SettlementUiStore) => {
  const { i18n } = useLingui();
  const state = useStoreSelector(store, selectPlacement, isShallowEqual);
  return useMemo(() => getPlacementStrip(state, i18n), [i18n, state]);
};

interface PlacementStripProps {
  store: SettlementUiStore;
  onCancel: () => void;
  onRotate: () => void;
}
/** Name of the active building / road / survey tool with Rotate (buildings only) and Cancel. */
export const PlacementStrip = ({ store, onCancel, onRotate }: PlacementStripProps) => {
  const { i18n } = useLingui();
  const { hidden, name, showRotate } = usePlacementStrip(store);
  return (
    <div className="settlement-ui__placement" hidden={hidden}>
      <span className="settlement-ui__placement-name">{name}</span>
      {showRotate && (
        <IconButton
          caption={i18n._(HUD_MESSAGES.placement.rotate)}
          icon="rotate"
          label={i18n._(HUD_MESSAGES.placement.rotateLabel)}
          onClick={onRotate}
        />
      )}
      <IconButton
        caption={i18n._(HUD_MESSAGES.placement.cancel)}
        icon="cancel"
        label={i18n._(HUD_MESSAGES.placement.cancelLabel)}
        onClick={onCancel}
      />
    </div>
  );
};
