import { useLingui } from "@lingui/react";

import { RadioGroup } from "../../components/radio-group";
import { Section } from "../../components/section";
import { getDialogueSpeedChoices } from "./helpers";
import { DIALOGUE_SPEED_MESSAGES as M } from "./messages";
import { useDialogueSpeed } from "./use-dialogue-speed";

/** Settings > Misc: how long story lines stay on screen (slow 75, normal 60, fast 45 ms per character). */
export const DialogueSpeedSection = () => {
  const { i18n } = useLingui();
  const { onSpeedChange, speed } = useDialogueSpeed();
  return (
    <Section icon="message" title={i18n._(M.title)}>
      <RadioGroup choices={getDialogueSpeedChoices(i18n)} label={i18n._(M.label)} selected={speed}
        onChange={onSpeedChange} />
    </Section>
  );
};
