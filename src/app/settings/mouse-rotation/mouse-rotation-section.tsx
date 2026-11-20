import { useLingui } from "@lingui/react";

import { RadioGroup } from "../../components/radio-group";
import { Section } from "../../components/section";
import { getMouseRotationChoices } from "./helpers";
import { MOUSE_ROTATION_MESSAGES as M } from "./messages";
import { useMouseRotation } from "./use-mouse-rotation";

/** Settings > Hotkeys: which mouse drag turns the camera (middle by default; right taps order soldiers). */
export const MouseRotationSection = () => {
  const { i18n } = useLingui();
  const { onRotationChange, rotation } = useMouseRotation();
  return (
    <Section icon="camera" title={i18n._(M.title)}>
      <RadioGroup choices={getMouseRotationChoices(i18n)} label={i18n._(M.label)} selected={rotation}
        onChange={onRotationChange} />
    </Section>
  );
};
