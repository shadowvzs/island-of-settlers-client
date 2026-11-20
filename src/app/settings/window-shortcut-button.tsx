import { useLingui } from "@lingui/react";

import { translateLabel } from "../../shared/i18n/translate";
import { IconButton } from "../components/icon-button";
import type { WindowShortcut } from "./window-shortcut";

interface WindowShortcutButtonProps {
  className?: string;
  shortcut: WindowShortcut;
}
/** One window shortcut: icon and caption (also its accessible name); the window returns focus to it. */
export const WindowShortcutButton = ({
  className, shortcut: { caption, icon, open, registerOpener }
}: WindowShortcutButtonProps) => {
  const { i18n } = useLingui();
  const label = translateLabel(i18n, caption);
  return (
    <IconButton
      caption={label}
      className={className}
      hasPopup="dialog"
      icon={icon}
      ref={registerOpener}
      onClick={open}
    />
  );
};
