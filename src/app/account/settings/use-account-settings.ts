import { useRef, useState } from "react";

/** The in-place confirmations of Settings > Account. */
export type AccountPanelName = "logOut" | "switchSlot";

/** Settings > Account state: the one open confirmation (a new key per opening: it starts clean). */
export const useAccountSettings = () => {
  const [panel, setPanel] = useState<{ key: number; name: AccountPanelName } | null>(null);
  const openings = useRef(0);
  return {
    openPanel: panel?.name ?? null,
    panelKey: panel?.key ?? 0,
    closePanel: () => setPanel(null),
    onOpen: (name: AccountPanelName) => setPanel({ key: ++openings.current, name })
  };
};
