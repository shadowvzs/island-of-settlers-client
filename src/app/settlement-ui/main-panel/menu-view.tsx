import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { useOnlineFeatures } from "../../backend/use-online-features";
import { IconButton } from "../../components/icon-button";
import type { WindowShortcut } from "../../settings/window-shortcut";
import { WindowShortcutButton } from "../../settings/window-shortcut-button";
import { getMenuEntries, type MenuEntryId } from "./helpers";

interface MenuViewProps {
  shortcuts: readonly WindowShortcut[];
  onMenuEntry: (id: MenuEntryId) => void;
}
/** Main selection: Buildings, Overview, Ships, Settings and the window shortcuts (Customization first). */
export const MenuView = ({ shortcuts, onMenuEntry }: MenuViewProps) => {
  const { i18n } = useLingui();
  const features = useOnlineFeatures();
  const entries = useMemo(() => getMenuEntries(i18n, features), [features, i18n]);
  return (
  <>
    {entries.map(entry => (
      <IconButton
        caption={entry.label}
        data={entry.data}
        icon={entry.icon}
        key={entry.id}
        label={entry.label}
        title={entry.title}
        onClick={() => onMenuEntry(entry.id)}
      />
    ))}
    {shortcuts.map(shortcut => <WindowShortcutButton key={shortcut.icon} shortcut={shortcut} />)}
  </>
  );
};
