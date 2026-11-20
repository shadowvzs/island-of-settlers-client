import type { I18n } from "@lingui/core";

import { translateDomainText } from "../../../shared/i18n/domain";
import { COMMAND_PENDING, type PendingCommand, settleCommand } from "../../components/helpers";
import { notifications } from "../../notifications/service";

/** Only the final user purchase outcome is important; transport pending/retry work stays silent. */
export const settleGemShopPurchase = (purchase: PendingCommand,
  success: string, i18n?: I18n, notify: Pick<typeof notifications, "success" | "error"> = notifications) =>
  settleCommand(purchase, result => {
    if (result === COMMAND_PENDING) return;
    if (result === true) notify.success(success, { important: true });
    else notify.error(translateDomainText(result, i18n), { important: true });
  });
