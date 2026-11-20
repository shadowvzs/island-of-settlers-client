import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { joinClassNames } from "../../components/helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { MainPanelView, MainPanelVisibility } from "./main-panel";

const MAIN_PANEL_TITLES = {
  build: M.menu.titleBuild,
  menu: M.menu.titleMenu,
  notices: M.menu.titleNotices,
  ships: M.menu.titleShips
} as const satisfies Readonly<Record<MainPanelView, unknown>>;

/** The frame's title, modifier classes and which view host shows. */
export const getMainPanelFrame = ({ view }: MainPanelVisibility, i18n?: I18n) => ({
  className: joinClassNames(
    view === "menu" && "settlement-ui__panel--main-selection",
    view === "notices" && "settlement-ui__panel--notices"
  ),
  hideBuild: view !== "build",
  hideMenu: view !== "menu",
  hideNotices: view !== "notices",
  hideShips: view !== "ships",
  title: translateMessage(i18n, MAIN_PANEL_TITLES[view])
});

/** Build focuses its selected category tab (the drag handle until the picker has rendered). */
export const focusMainPanelView = (view: MainPanelView, buildHost: HTMLElement | null, handle: HTMLElement) => {
  const tab = view === "build" ? buildHost?.querySelector<HTMLElement>('[aria-selected="true"]') : null;
  (tab ?? handle).focus();
};
