import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { SettlementIcon } from "../../components/settlement-icon";
import { isShallowEqual } from "../../components/ui-store";
import { useStoreSelector } from "../../components/use-store-selector";
import type { SettlementUiStore } from "../ui-store";
import { getLauncherRows, type LauncherId, type LauncherRow, selectBottomBar } from "./helpers";

interface LauncherButtonProps {
  row: LauncherRow;
  onLauncher: (id: LauncherId, opener?: HTMLElement) => void;
}
const LauncherButton = ({ row, onLauncher }: LauncherButtonProps) => (
  <button
    aria-haspopup="dialog"
    aria-label={row.label}
    aria-pressed={row.pressed}
    className={row.className}
    data-launcher-id={row.id}
    data-ui-anchor={row.anchor}
    disabled={row.disabled}
    title={row.title}
    type="button"
    onClick={event => onLauncher(row.id, event.currentTarget)}
  >
    <SettlementIcon name={row.icon} />
  </button>
);

const useBottomBar = (store: SettlementUiStore, campaign: boolean) => {
  const { i18n } = useLingui();
  const state = useStoreSelector(store, selectBottomBar, isShallowEqual);
  return useMemo(() => getLauncherRows(state, i18n, campaign), [campaign, i18n, state]);
};

interface BottomBarProps {
  /** The session offers campaigns: the home island shows their launcher. */
  campaign: boolean;
  store: SettlementUiStore;
  onLauncher: (id: LauncherId, opener?: HTMLElement) => void;
}
/** Build, Inventory, Map, Menu, Campaign (home only) and News launchers (icon only) inside `nav.settlement-ui__bar`. */
export const BottomBar = ({ campaign, store, onLauncher }: BottomBarProps) => (
  <>
    {useBottomBar(store, campaign).map(row => <LauncherButton key={row.id} row={row} onLauncher={onLauncher} />)}
  </>
);
