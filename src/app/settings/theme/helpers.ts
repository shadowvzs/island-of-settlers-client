import type { I18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

import darkModeIconUrl from "../../../../assets/ui-icons/mode-dark.png?url";
import lightModeIconUrl from "../../../../assets/ui-icons/mode-light.png?url";
import { translateMessage } from "../../../shared/i18n/translate";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";

export type HudTheme = "light" | "dark";

/** Surface styles (hud-styles.css); each works with the light and the dark palette. */
const HUD_STYLES = [
  { id: "current", label: M.theme.styleName.current },
  { id: "parchment", label: M.theme.styleName.parchment },
  { id: "vellum", label: M.theme.styleName.vellum },
  { id: "paper-window", label: M.theme.styleName.paperWindow },
  { id: "clean-window", label: M.theme.styleName.cleanWindow },
  { id: "bevel", label: M.theme.styleName.bevel },
  { id: "plaque", label: M.theme.styleName.plaque },
  { id: "carved", label: M.theme.styleName.carved }
] as const satisfies readonly { id: string; label: MessageDescriptor }[];
export type HudStyle = (typeof HUD_STYLES)[number]["id"];

/** The theme popover's choice: palette mode and surface style. */
export interface HudThemeChoice {
  style: HudStyle;
  theme: HudTheme;
}

const isHudStyle = (value: string | null): value is HudStyle => HUD_STYLES.some(style => style.id === value);

/** Stored values, or light and "current" when nothing (or something unknown) is stored. */
export const parseHudTheme = (storedStyle: string | null, storedTheme: string | null): HudThemeChoice => ({
  style: isHudStyle(storedStyle) ? storedStyle : "current",
  theme: storedTheme === "dark" ? "dark" : "light"
});

const MODES: readonly { iconUrl: string; label: MessageDescriptor; value: HudTheme }[] = [
  { iconUrl: lightModeIconUrl, label: M.theme.light, value: "light" },
  { iconUrl: darkModeIconUrl, label: M.theme.dark, value: "dark" }
];

/** One radio of the popover's Mode group, with its rendered 3D sun or moon. */
export interface ModeOption {
  checked: boolean;
  iconUrl: string;
  label: string;
  value: HudTheme;
}

export const getModeOptions = (theme: HudTheme, i18n?: I18n): ModeOption[] =>
  MODES.map(mode => ({ ...mode, checked: mode.value === theme, label: translateMessage(i18n, mode.label) }));

/** One radio of the popover's Style group (its swatch draws a mini window and button in that style). */
export interface StyleOption {
  checked: boolean;
  label: string;
  value: HudStyle;
}

export const getStyleOptions = (style: HudStyle, i18n?: I18n): StyleOption[] =>
  HUD_STYLES.map(({ id, label }) => ({ checked: id === style, label: translateMessage(i18n, label), value: id }));
