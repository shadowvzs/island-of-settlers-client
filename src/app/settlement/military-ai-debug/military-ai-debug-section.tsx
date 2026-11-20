import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { Checkbox } from "../../components/checkbox";
import { type ExternalStore, useExternalStore } from "../../components/external-store";
import { Section } from "../../components/section";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "../debug-messages";
import type { MilitaryAiDebug } from "../military-ai-debug";
import { MILITARY_AI_LEGEND } from "./helpers";
import { useMilitaryAiDebug } from "./use-military-ai-debug";

interface MilitaryAiControlsProps {
  debug: MilitaryAiDebug;
}
const MilitaryAiControls = ({ debug }: MilitaryAiControlsProps) => {
  const { i18n } = useLingui();
  const { overlay, onOverlayChange } = useMilitaryAiDebug(debug);
  return (
    <Section title={i18n._(M.military.ai.title)}>
      <div>
        <p role="status">{translateMessage(i18n, M.military.ai.mode, {
          mode: i18n._(M.military.ai.shippedMode)
        })}</p>
        <Checkbox checked={overlay} label={i18n._(M.military.ai.overlay)} onChange={onOverlayChange} />
        <p>{i18n._(MILITARY_AI_LEGEND)}</p>
      </div>
    </Section>
  );
};

interface MilitaryAiDebugSectionProps {
  debug: ExternalStore<MilitaryAiDebug | null>;
}
/** Development tools > Military: fixed AI mode and the debug overlay, shown once the simulation exists. */
export const MilitaryAiDebugSection = ({ debug }: MilitaryAiDebugSectionProps) => {
  const current = useExternalStore(debug);
  if (!current) return null;
  return <MilitaryAiControls debug={current} />;
};
