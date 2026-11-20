import type { I18n } from "@lingui/core";

import { translateMessage } from "../shared/i18n/translate";
import { createLazyReactContent } from "./components/lazy-react-content";
import { createExternalStore } from "./components/ui-store";
import { rawTextCodec } from "./preferences/codecs";
import { PREFERENCES } from "./preferences/keys";
import { definePreference } from "./preferences/registry";
import { SETTINGS_CHROME_MESSAGES as M } from "./settings/chrome-messages";
import type { CornerRow } from "./settings/corner-row/corner-row";
import { type HudStyle, type HudTheme, type HudThemeChoice, parseHudTheme } from "./settings/theme/helpers";
import { registerSettlementWindowOrder } from "./settlement-ui/window-order";
import { getWindowLayer, isolatePointer } from "./window-layer";

const hudTheme = definePreference(PREFERENCES.hudPaperTheme, rawTextCodec);
const hudStyle = definePreference(PREFERENCES.hudSurfaceStyle, rawTextCodec);

/** Mode and surface style stored by the theme popover (light, "current" by default). */
const readHudTheme = () => parseHudTheme(hudStyle.read(), hudTheme.read());

const setRootTheme = ({ style, theme }: HudThemeChoice) => {
  const root = document.documentElement;
  root.dataset.hudTheme = theme;
  if (style === "current") delete root.dataset.hudStyle;
  else root.dataset.hudStyle = style;
};

/** The stored theme on <html> before any HUD exists (the registration scroll). */
export const applyStoredHudTheme = () => setRootTheme(readHudTheme());

/** The current choice and its actions: each pick is stored and applied to <html> at once. */
const createHudThemeControls = () => {
  const store = createExternalStore(readHudTheme());
  const choose = (next: HudThemeChoice) => {
    setRootTheme(next);
    store.set(next);
  };
  return {
    setStyle: (style: HudStyle) => {
      hudStyle.write(style);
      choose({ ...store.getSnapshot(), style });
    },
    setTheme: (theme: HudTheme) => {
      hudTheme.write(theme);
      choose({ ...store.getSnapshot(), theme });
    },
    store
  };
};

export type HudThemeControls = ReturnType<typeof createHudThemeControls>;

const THEME_BUTTON_ID = "theme";
const THEME_BUTTON_CLASS = "hud-theme-toggle";

/** A press on the toggle itself is its click, not an outside press. */
const isToggleTarget = (target: EventTarget | null) =>
  target instanceof Element && target.closest(`.${THEME_BUTTON_CLASS}`) !== null;

/**
 * Theme popover: a mode (light/dark palette) and a surface style for buttons and windows. This frame
 * owns visibility, z-order, outside-press and Escape closing; its React radios load on first open and its
 * toggle leads the corner row. Independent from graphics, map-editor visibility and the bottom launchers.
 */
export const createHudThemeToggle = (container: HTMLElement, row: CornerRow, i18n?: I18n) => {
  const popover = document.createElement("div");
  popover.className = "hud-theme-popover";
  popover.hidden = true;
  const events = new AbortController();
  const activate = registerSettlementWindowOrder(popover, events.signal);
  isolatePointer(popover);
  const controls = createHudThemeControls();
  const content = createLazyReactContent(popover, translateMessage(i18n, M.theme.window), async () =>
    (await import("./settings/theme/mount-theme-popover")).createThemePopoverMount(controls, i18n));
  const showPressed = () => row.update(THEME_BUTTON_ID, { pressed: controls.store.getSnapshot().theme === "dark" });
  const unsubscribe = controls.store.subscribe(showPressed);
  const setOpen = (open: boolean) => {
    popover.hidden = !open;
    if (open) {
      activate();
      content.mount();
    }
    row.update(THEME_BUTTON_ID, { expanded: open });
  };
  const onOutside = (event: PointerEvent) => {
    if (popover.hidden || popover.contains(event.target as Node) || isToggleTarget(event.target)) return;
    setOpen(false);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || popover.hidden) return;
    event.preventDefault();
    setOpen(false);
  };
  row.add({
    className: THEME_BUTTON_CLASS, hasPopup: true, icon: { kind: "settlement", name: "theme" }, id: THEME_BUTTON_ID,
    label: translateMessage(i18n, M.theme.title), onClick: () => setOpen(popover.hidden === true)
  }, { expanded: false, pressed: false }, "start");
  document.addEventListener("pointerdown", onOutside);
  document.addEventListener("keydown", onKey);
  getWindowLayer(container).append(popover);
  setRootTheme(controls.store.getSnapshot());
  showPressed();
  return {
    dispose: () => {
      events.abort();
      unsubscribe();
      content.unmount();
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onKey);
      row.remove(THEME_BUTTON_ID);
      popover.remove();
    }
  };
};
