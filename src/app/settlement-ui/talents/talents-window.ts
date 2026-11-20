import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";

/** Talents window opened from the player HUD; pending points stay until applied or reset. */
export const createTalentsWindow = (
  store: SettlementUiStore, options: Pick<SettlementUiOptions, "i18n" | "onApplyTalents" | "onResetTalents">
) =>
  createReactSettlementWindow({
    className: "settlement-ui__talents-window",
    contentClassName: "settlement-ui__overview talents",
    heading: translateMessage(options.i18n, M.talents.title),
    id: "settlement-talents-title",
    load: async visibility => (await import("./mount")).createTalentsMount(store, visibility, options)
  });
