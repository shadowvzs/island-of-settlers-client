import type { MessageDescriptor } from "@lingui/core";

import { joinClassNames } from "../../components/helpers";
import { type CameraIcon, getCameraIconSource } from "../camera-icons";

/** The icon of a corner button: a HUD action icon, or the camera panel's own render. */
export type CornerIcon = { kind: "camera"; name: CameraIcon } | { kind: "settlement"; name: string };

/** Live state of a corner button, changed by its owner (panel open, theme mode, hidden with a settlement). */
export interface CornerButtonState {
  active?: boolean;
  expanded?: boolean;
  hidden?: boolean;
  pressed?: boolean;
}

/** A square icon button of the top right row; its owner keeps the click logic and the panel it opens. */
export interface CornerButtonSpec {
  /** Extra class (e.g. `hud-theme-toggle`, read by CSS and drivers). */
  className?: string;
  /** Opens a popup that is not a corner panel (`aria-haspopup`). */
  hasPopup?: boolean;
  icon: CornerIcon;
  id: string;
  /** Accessible name and tooltip; a descriptor follows the locale. */
  label: string | MessageDescriptor;
  onClick: () => void;
}

export type CornerButton = CornerButtonSpec & CornerButtonState;

/** A corner button ready to render: classes, ARIA states and the icon to draw. */
export interface CornerButtonView {
  /** Camera render URL (drawn as a 36 px image like the camera panel buttons). */
  cameraIconSource?: string;
  className: string;
  expanded?: boolean;
  hasPopup?: "true";
  hidden?: boolean;
  id: string;
  label: string | MessageDescriptor;
  pressed?: boolean;
  /** HUD action icon name (drawn by `SettlementIcon`). */
  settlementIcon?: string;
  onClick: () => void;
}

const BUTTON_CLASS_NAME = "settings__icon";

const getButtonClassName = ({ active, className }: CornerButton) =>
  joinClassNames(BUTTON_CLASS_NAME, className, active && "is-active");

const getIconFields = (icon: CornerIcon) => {
  if (icon.kind === "camera") return { cameraIconSource: getCameraIconSource(icon.name) };
  return { settlementIcon: icon.name };
};

const getHasPopup = (hasPopup: boolean | undefined) => (hasPopup ? "true" : undefined);

export const getCornerButtonView = (button: CornerButton): CornerButtonView => ({
  ...getIconFields(button.icon),
  className: getButtonClassName(button),
  expanded: button.expanded,
  hasPopup: getHasPopup(button.hasPopup),
  hidden: button.hidden,
  id: button.id,
  label: button.label,
  pressed: button.pressed,
  onClick: button.onClick
});

/** Adds a button first (the theme toggle leads the row) or last. */
export const addCornerButton = (
  buttons: readonly CornerButton[], button: CornerButton, position: "end" | "start"
): readonly CornerButton[] => (position === "start" ? [button, ...buttons] : [...buttons, button]);

const hasChanges = (button: CornerButton, changes: CornerButtonState) =>
  (Object.keys(changes) as (keyof CornerButtonState)[]).some(key => button[key] !== changes[key]);

/** The row with one button's state changed; the same array when nothing changed (no publish). */
export const updateCornerButton = (
  buttons: readonly CornerButton[], id: string, changes: CornerButtonState
): readonly CornerButton[] => {
  const index = buttons.findIndex(button => button.id === id);
  if (index < 0 || !hasChanges(buttons[index]!, changes)) return buttons;
  return buttons.map(button => (button.id === id ? { ...button, ...changes } : button));
};
