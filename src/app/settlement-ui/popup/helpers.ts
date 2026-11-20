import type { I18n } from "@lingui/core";

import { joinClassNames } from "../../components/helpers";
import { getRewardIconsView } from "../reward-icons/helpers";
import type { SettlementPopupAction, SettlementPopupContent } from "../settlement-popup";

export const POPUP_TITLE_ID = "settlement-popup-title";

/** One action button: an icon button (with or without caption) or a plain text button. */
const getPopupActionButton = (action: SettlementPopupAction, index: number) => ({
  caption: action.iconOnly ? undefined : action.label,
  className: joinClassNames(action.iconOnly && "settlement-popup__icon-action",
    action.primary && "settlement-ui__button--primary"),
  icon: action.icon,
  key: `${index}:${action.label}`,
  label: action.label,
  textClassName: joinClassNames("settlement-ui__button settlement-popup__text-button",
    action.primary && "settlement-ui__button--primary")
});

export type PopupActionButton = ReturnType<typeof getPopupActionButton>;

/** Everything the popup card renders, prepared from its content. */
export const getPopupView = (content: SettlementPopupContent, i18n?: I18n) => ({
  actions: content.actions.map(getPopupActionButton),
  art: content.art,
  buildings: content.buildings ?? [],
  className: content.rewards ? "settlement-popup__dialog--rewards" : undefined,
  message: content.message,
  rewards: content.rewards && getRewardIconsView(content.rewards.entries, { i18n }),
  title: content.title,
  tone: content.tone ?? "question"
});
