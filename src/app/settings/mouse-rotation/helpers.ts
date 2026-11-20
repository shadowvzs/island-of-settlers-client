import type { I18n } from "@lingui/core";

import { MOUSE_ROTATIONS, type MouseRotation } from "../../../render-common/camera-drag-mapping";
import { translateMessage } from "../../../shared/i18n/translate";
import type { SelectOption } from "../../components/helpers";
import { MOUSE_ROTATION_MESSAGES as M } from "./messages";

/** Radio choices of the setting, in the settings order. */
export const getMouseRotationChoices = (i18n?: I18n): SelectOption<MouseRotation>[] =>
  MOUSE_ROTATIONS.map(rotation => ({ label: translateMessage(i18n, M.rotations[rotation]), value: rotation }));
