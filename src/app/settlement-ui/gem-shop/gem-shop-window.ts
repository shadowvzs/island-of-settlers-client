import { translateMessage } from "../../../shared/i18n/translate";
import { guardedByOnlineFeature } from "../../backend/online-features";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { DECORATION_SHOP_MESSAGES as D } from "./decoration-messages";
import { createDecorationPreviewActions } from "./decoration-preview";

/**
 * Gem shop window opened from the HUD gem counter; reopens on the last category. While the game's shop switch
 * is off it never opens, whoever asks (HUD, map script).
 */
export const createGemShopWindow = (
  store: SettlementUiStore, options: Pick<SettlementUiOptions, "i18n" | "onBuyGemOffer">
) => {
  const actions = createDecorationPreviewActions(store, options, () => preview.close(), options.i18n);
  const preview = createReactSettlementWindow({
    className: "gem-shop-preview-window", contentClassName: "gem-shop-preview-body",
    heading: translateMessage(options.i18n, D.preview), id: "gem-shop-preview-title",
    load: async visibility => (await import("./mount-decoration-preview")).createDecorationPreviewMount({ actions, store, visibility }),
    onClose: () => actions.selection.set(undefined)
  });
  const shop = createReactSettlementWindow({
    className: "settlement-ui__gem-shop-window",
    contentClassName: "settlement-ui__overview gem-shop",
    heading: translateMessage(options.i18n, M.gemShop.title),
    id: "settlement-gem-shop-title",
    onClose: actions.cancel,
    load: async visibility => (await import("./mount")).createGemShopMount(store, visibility, { ...options, onPreviewDecoration: id => {
      if (actions.select(id)) preview.open();
    } })
  });

  const root = document.createElement("div");
  root.append(shop.root, preview.root);
  const stopLocale = options.i18n?.on("change", () => preview.setTitle(translateMessage(options.i18n, D.preview)));
  return guardedByOnlineFeature("shop", { ...shop, root,
    close: () => { actions.cancel(); shop.close(); },
    dispose: () => { stopLocale?.(); preview.dispose(); shop.dispose(); root.remove(); }
  });
};
