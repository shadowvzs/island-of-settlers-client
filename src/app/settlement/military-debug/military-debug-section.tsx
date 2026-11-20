import { useLingui } from "@lingui/react";

import { type ExternalStore, useExternalStore } from "../../components/external-store";
import { DevelopmentToolGrid } from "../../settings/development/development-tool-grid";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "../debug-messages";
import type { MilitaryDebugControls } from "./helpers";

interface MilitaryDebugContentProps {
  controls: MilitaryDebugControls;
}
const MilitaryDebugContent = ({ controls: { hidden, tools } }: MilitaryDebugContentProps) => {
  const { i18n } = useLingui();
  const isHidden = useExternalStore(hidden);
  return (
    <section aria-label={i18n._(M.military.debugSection.label)} hidden={isHidden}>
      <DevelopmentToolGrid tools={tools} />
    </section>
  );
};

interface MilitaryDebugSectionProps {
  debug: ExternalStore<MilitaryDebugControls | null>;
}
/** Development tools > Military: training encounter and soldier spawn, once a settlement exists. */
export const MilitaryDebugSection = ({ debug }: MilitaryDebugSectionProps) => {
  const current = useExternalStore(debug);
  if (!current) return null;
  return <MilitaryDebugContent controls={current} />;
};
