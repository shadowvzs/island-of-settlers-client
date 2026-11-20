import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { createReactSettlementWindow } from "../react-window";
import { SUPPORT_MESSAGES as M } from "./messages";

import "./support.css";

/** Support window opened from the last bottom-bar launcher: the donation links and QR code. */
export const createSupportWindow = (i18n?: I18n) =>
  createReactSettlementWindow({
    className: "settlement-ui__support-window",
    contentClassName: "support-panel",
    heading: translateMessage(i18n, M.title),
    id: "settlement-support-title",
    load: async () => (await import("./mount")).createSupportMount()
  });
