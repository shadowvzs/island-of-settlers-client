import { useLingui } from "@lingui/react";
import type { ReactNode } from "react";

import { IconButton } from "../../components/icon-button";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { getPauseCaption } from "./helpers";

interface PauseButtonProps {
  id: string;
  paused: boolean;
  onPause: (paused: boolean) => void;
}
/** Stop / Resume production; the label follows the authoritative paused flag. */
export const PauseButton = ({ id, paused, onPause }: PauseButtonProps) => {
  const { i18n } = useLingui();
  return (
    <IconButton
      caption={getPauseCaption(paused, i18n)}
      data={{ "data-production-pause": id }}
      icon="settings"
      pressed={paused}
      title={i18n._(M.details.pauseTitle)}
      onClick={() => onPause(!paused)}
    />
  );
};

interface DemolishButtonProps {
  id: string;
  onDemolish: () => void;
}
export const DemolishButton = ({ id, onDemolish }: DemolishButtonProps) => {
  const { i18n } = useLingui();
  return (
    <IconButton
      caption={i18n._(M.details.demolishCaption)}
      data={{ "data-demolish-building": id }}
      icon="demolish"
      label={i18n._(M.details.demolishLabel)}
      onClick={onDemolish}
    />
  );
};

interface StoragePageButtonProps {
  id: string;
  label: string;
  pressed: boolean;
  onToggle: () => void;
}
/** The register (book) cycles Resources, Settlers and Soldiers for storage buildings. */
export const StoragePageButton = ({ id, label, pressed, onToggle }: StoragePageButtonProps) => (
  <IconButton
    caption=""
    data={{ "data-storage-page-next": id }}
    icon="register"
    label={label}
    pressed={pressed}
    onClick={onToggle}
  />
);

interface BuildingFooterProps {
  children: ReactNode;
}
/** Building-specific sections stay above this consistently aligned action row. */
export const BuildingFooter = ({ children }: BuildingFooterProps) => (
  <div className="settlement-ui__building-actions">{children}</div>
);
