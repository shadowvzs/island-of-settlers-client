import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { ExternalStore } from "../../components/ui-store";
import type { ObservationPickKind } from "../../observation/helpers";
import { ObservationLaunchers } from "../../observation/observation-launchers";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";
import type { CameraBookmarkControls } from "./bookmark-controls";
import { CameraBookmarks } from "./camera-bookmarks-view";
import { CameraButton } from "./camera-button";
import type { CameraPad } from "./camera-pad";
import { CameraPadView } from "./camera-pad-view";
import { useCameraPanel } from "./use-camera-panel";
import type { ZoomControl } from "./zoom-control";

export interface CameraPanelProps {
  bookmarks?: CameraBookmarkControls;
  i18n?: I18n;
  cinematic: ExternalStore<boolean>;
  pad: CameraPad;
  zoom: ZoomControl;
  onCinematic: () => void;
  onReset: () => void;
  /** Watch worker / ship (absent: no launchers). */
  onWatch?: (kind: ObservationPickKind) => void;
}
/** Camera panel content: zoom, move / rotate pad, view toggles, observation launchers and bookmarks. */
export const CameraPanel = ({
  bookmarks, cinematic, i18n, pad, zoom, onCinematic, onReset, onWatch
}: CameraPanelProps) => {
  const { cinematicClassName, cinematicPressed, viewClassName, zoomClassName, zoomIn, zoomOut } =
    useCameraPanel(zoom, cinematic);
  return (
    <>
      <div className="camera-main-controls">
        <div aria-label={translateMessage(i18n, M.camera.zoom)} className="camera-control-row camera-zoom-controls" role="group">
          <CameraButton className={zoomClassName} disabled={zoomIn.disabled} icon="plus" label={translateMessage(i18n, M.camera.zoomIn)}
            onClick={zoomIn.onClick} onPointerDown={zoomIn.onPointerDown} />
          <CameraButton className={zoomClassName} disabled={zoomOut.disabled} icon="minus" label={translateMessage(i18n, M.camera.zoomOut)}
            onClick={zoomOut.onClick} onPointerDown={zoomOut.onPointerDown} />
        </div>
        <CameraPadView i18n={i18n} pad={pad} />
        <div aria-label={translateMessage(i18n, M.camera.view)} className="camera-control-row camera-view-controls" role="group">
          <CameraButton className={cinematicClassName} icon="camera" label={translateMessage(i18n, M.camera.cinematic)}
            pressed={cinematicPressed} onClick={onCinematic} />
          <CameraButton className={viewClassName} icon="reset" label={translateMessage(i18n, M.camera.reset)} onClick={onReset} />
        </div>
        {onWatch && <ObservationLaunchers onWatch={onWatch} />}
      </div>
      {bookmarks && <CameraBookmarks controls={bookmarks} i18n={i18n} />}
    </>
  );
};
