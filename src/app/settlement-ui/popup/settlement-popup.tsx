import type { SettlementPopupStore } from "../settlement-popup";
import { PopupView } from "./popup-view";
import { useSettlementPopup } from "./use-settlement-popup";

interface SettlementPopupProps {
  store: SettlementPopupStore;
  onClose: () => void;
}
/** The popup card inside the DOM backdrop; renders nothing while no popup is shown. */
export const SettlementPopup = ({ store, onClose }: SettlementPopupProps) => {
  const { revision, view, onAction } = useSettlementPopup(store, onClose);
  if (!view) return null;
  return <PopupView revision={revision} view={view} onAction={onAction} />;
};
