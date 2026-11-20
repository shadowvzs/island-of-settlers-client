import type { I18n } from "@lingui/core";

import { mountReactIsland } from "../../components/react-island";
import type { HudThemeControls } from "../../hud-theme";
import { ThemePopover } from "./theme-popover";

/** Mounter for `createLazyReactContent`: the popover's radios load with React on its first open. */
export const createThemePopoverMount = (controls: HudThemeControls, i18n?: I18n) =>
  (content: HTMLElement) => mountReactIsland(content, <ThemePopover controls={controls} i18n={i18n} />);
