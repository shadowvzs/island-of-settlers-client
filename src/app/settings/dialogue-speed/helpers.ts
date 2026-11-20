import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { SelectOption } from "../../components/helpers";
import { DIALOGUE_SPEEDS } from "./constants";
import { DIALOGUE_SPEED_MESSAGES as M } from "./messages";
import type { DialogueSpeed } from "./preference";

/** Radio choices of the setting, slowest first. */
export const getDialogueSpeedChoices = (i18n?: I18n): SelectOption<DialogueSpeed>[] =>
  DIALOGUE_SPEEDS.map(speed => ({ label: translateMessage(i18n, M.speeds[speed]), value: speed }));
