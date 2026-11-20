import { useLingui } from "@lingui/react";

import { translateLabel } from "../../../shared/i18n/translate";
import { LabelledButton } from "../../components/labelled-button";
import { SettlementIcon } from "../../components/settlement-icon";
import { CameraIconImage } from "../camera-icon-image";
import type { CornerRowStore } from "./corner-row";
import type { CornerButtonView } from "./helpers";
import { useCornerRow } from "./use-corner-row";

interface CornerIconProps {
  button: CornerButtonView;
}
const CornerIcon = ({ button: { cameraIconSource, settlementIcon } }: CornerIconProps) => (
  <>
    {settlementIcon && <SettlementIcon className="settings__icon-image" name={settlementIcon} />}
    {cameraIconSource && <CameraIconImage source={cameraIconSource} />}
  </>
);

interface CornerButtonProps {
  button: CornerButtonView;
}
const CornerButton = ({ button }: CornerButtonProps) => {
  const { i18n } = useLingui();
  return (
    <LabelledButton
      className={button.className}
      expanded={button.expanded}
      hasPopup={button.hasPopup}
      hidden={button.hidden}
      label={translateLabel(i18n, button.label)}
      pressed={button.pressed}
      onClick={button.onClick}
    >
      <CornerIcon button={button} />
    </LabelledButton>
  );
};

interface CornerRowProps {
  store: CornerRowStore;
}
/** The top right icon buttons (theme, panels, camera) rendered into `.settings__buttons`. */
export const CornerRow = ({ store }: CornerRowProps) => (
  <>
    {useCornerRow(store).map(button => <CornerButton button={button} key={button.id} />)}
  </>
);
