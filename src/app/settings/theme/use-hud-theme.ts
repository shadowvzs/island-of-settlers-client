import { useExternalStore } from "../../components/external-store";
import type { HudThemeControls } from "../../hud-theme";
import { getModeOptions, getStyleOptions } from "./helpers";

export const useHudTheme = ({ setStyle, setTheme, store }: HudThemeControls) => {
  const { style, theme } = useExternalStore(store);
  return { modes: getModeOptions(theme), styles: getStyleOptions(style), onMode: setTheme, onStyle: setStyle };
};
