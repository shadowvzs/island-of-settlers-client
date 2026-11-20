import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { UnitDecisionReasonCode } from "../../shared/settlement/unit-decision-diagnostics";
import { UNIT_DECISION_MESSAGES } from "./unit-decision-messages";

/** Localized caption of one read-only unit decision reason. */
export const getUnitReasonText = (i18n: I18n | undefined, reason: UnitDecisionReasonCode) =>
  translateMessage(i18n, UNIT_DECISION_MESSAGES[reason]);
