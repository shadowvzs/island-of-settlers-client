import { useLingui } from "@lingui/react";

import type { FisherBoatStatus, FisherMode } from "../../../shared/settlement/settlement-fisher-boat-mode";
import { getFisherModeView } from "./fisher-mode-helpers";
import { ProductionModeChoices } from "./production-mode-choices";
import { selectModeChoice } from "./production-mode-helpers";

interface FisherModeSectionProps {
  buildingId: string;
  status: FisherBoatStatus;
  onChange: (mode: FisherMode) => boolean | void;
}
/** Fishery: rod or boat fishing; an unavailable boat explains why (FISHER-BOAT §4). */
export const FisherModeSection = ({ buildingId, status, onChange }: FisherModeSectionProps) => {
  const { i18n } = useLingui();
  const view = getFisherModeView(status, i18n);
  const helpId = `fisher-mode-help-${buildingId}`;
  return (
    <section aria-label={view.heading} className="settlement-ui__fisher-mode">
      <h3>{view.heading}</h3>
      <ProductionModeChoices choices={view.choices} helpId={helpId}
        onChange={mode => selectModeChoice(view.choices, mode, onChange)} />
      <p className="settlement-ui__section-description" id={helpId}>{view.description}</p>
      {view.blockReason && <p className="settlement-ui__hint" role="note">{view.blockReason}</p>}
      {view.place && <p className="settlement-ui__section-description">{view.place}</p>}
    </section>
  );
};
