import type { I18n } from "@lingui/core";
import type { ReactNode } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { HudThemeControls } from "../../hud-theme";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";
import type { HudStyle, HudTheme, ModeOption, StyleOption } from "./helpers";
import { useHudTheme } from "./use-hud-theme";

interface ThemeGroupProps {
  children: ReactNode;
  title: string;
}
const ThemeGroup = ({ children, title }: ThemeGroupProps) => (
  <div aria-label={title} className="hud-theme-popover__group" role="radiogroup">
    <strong>{title}</strong>
    {children}
  </div>
);

interface ThemePopoverViewProps {
  i18n?: I18n;
  modes: readonly ModeOption[];
  styles: readonly StyleOption[];
  onMode: (theme: HudTheme) => void;
  onStyle: (style: HudStyle) => void;
}
const ThemePopoverView = ({ i18n, modes, styles, onMode, onStyle }: ThemePopoverViewProps) => (
  <>
    <ThemeGroup title={translateMessage(i18n, M.theme.mode)}>
      {modes.map(({ checked, iconUrl, label, value }) => (
        <button
          aria-checked={checked}
          className="hud-theme-popover__option"
          data-hud-mode={value}
          key={value}
          role="radio"
          type="button"
          onClick={() => onMode(value)}
        >
          <img alt="" className="hud-theme-popover__mode-icon" draggable={false} src={iconUrl} />
          {label}
        </button>
      ))}
    </ThemeGroup>
    <ThemeGroup title={translateMessage(i18n, M.theme.style)}>
      {styles.map(({ checked, label, value }) => (
        <button
          aria-checked={checked}
          className="hud-theme-popover__option"
          data-hud-style-option={value}
          key={value}
          role="radio"
          type="button"
          onClick={() => onStyle(value)}
        >
          <span className="hud-theme-popover__swatch" data-hud-swatch={value} />
          {label}
        </button>
      ))}
    </ThemeGroup>
  </>
);

interface ThemePopoverProps {
  controls: HudThemeControls;
  i18n?: I18n;
}
export const ThemePopover = ({ controls, i18n }: ThemePopoverProps) =>
  <ThemePopoverView {...useHudTheme(controls)} i18n={i18n} />;
