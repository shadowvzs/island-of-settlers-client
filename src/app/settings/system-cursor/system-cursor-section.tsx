import { useLingui } from "@lingui/react";

import { Checkbox } from "../../components/checkbox";
import { Section } from "../../components/section";
import { SYSTEM_CURSOR_MESSAGES as M } from "./messages";
import { useSystemCursor } from "./use-system-cursor";

/** Settings > Misc: the game cursor set or the system pointer; hidden on touch screens. */
export const SystemCursorSection = () => {
  const { i18n } = useLingui();
  const { enabled, onEnabledChange, visible } = useSystemCursor();
  if (!visible) return null;
  return (
    <Section icon="settings" title={i18n._(M.title)}>
      <Checkbox checked={enabled} label={i18n._(M.label)} title={i18n._(M.hint)} onChange={onEnabledChange} />
    </Section>
  );
};
