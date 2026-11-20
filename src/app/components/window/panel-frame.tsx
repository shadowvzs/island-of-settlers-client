import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";

import { translateLabel } from "../../../shared/i18n/translate";
import { joinClassNames } from "../helpers";
import { SettlementIcon } from "../settlement-icon";
import { getPanelCloseLabel } from "./helpers";
import { usePanelFrame } from "./use-panel-frame";

export interface PanelFrameProps {
  /** Classes besides `settings-panel`. */
  className?: string;
  /** DOM content below the header (it has its own lazily mounted React root). */
  content?: HTMLElement;
  label: string | MessageDescriptor;
  open: boolean;
  onClose: () => void;
}
/**
 * A fixed corner panel (`div.settings-panel`): header with the title and the close button, then the content.
 * Visibility comes from the owner; the frame joins the shared z-order and rises when it opens.
 */
export const PanelFrame = ({ className, content, label, open, onClose }: PanelFrameProps) => {
  const { i18n } = useLingui();
  const panelRef = usePanelFrame(content, open);
  const title = translateLabel(i18n, label);
  return (
    <div className={joinClassNames("settings-panel", className)} hidden={!open} ref={panelRef}>
      <header className="settings-panel__header">
        <strong>{title}</strong>
        <button aria-label={getPanelCloseLabel(title, i18n)} className="settings-panel__close" type="button" onClick={onClose}>
          <SettlementIcon className="settings__icon-image" name="cancel" />
        </button>
      </header>
    </div>
  );
};
