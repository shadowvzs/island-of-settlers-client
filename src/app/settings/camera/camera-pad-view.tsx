import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";
import { CameraButton } from "./camera-button";
import type { CameraPad, CameraPadButton } from "./camera-pad";

const HOLD_BUTTON_CLASS = "camera-control-button";

interface HoldButtonProps {
  button: CameraPadButton;
}
/** A pad button: its hold loop (outside React) runs while it is pressed. */
const HoldButton = ({ button: { gridArea, hold, icon, label } }: HoldButtonProps) => (
  <CameraButton
    className={HOLD_BUTTON_CLASS}
    gridArea={gridArea}
    icon={icon}
    label={label}
    onClick={event => hold.click(event.detail)}
    onPointerDown={hold.press}
    onPointerRelease={hold.release}
  />
);

interface CameraPadViewProps {
  i18n?: I18n;
  pad: CameraPad;
}
/** Move pad and rotate / pitch buttons. */
export const CameraPadView = ({ i18n, pad }: CameraPadViewProps) => (
  <div className="camera-control-sections">
    <div aria-label={translateMessage(i18n, M.camera.move)} className="camera-control-pad" role="group">
      {pad.moves.map(button => <HoldButton button={button} key={button.label} />)}
    </div>
    <div aria-label={translateMessage(i18n, M.camera.rotate)} className="camera-control-grid" role="group">
      {pad.rotations.map(button => <HoldButton button={button} key={button.label} />)}
    </div>
  </div>
);
