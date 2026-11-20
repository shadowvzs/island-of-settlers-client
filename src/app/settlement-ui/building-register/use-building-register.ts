import { useLingui } from "@lingui/react";
import { useMemo, useRef } from "react";

import { isDeepEqual } from "../../components/ui-store";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import {
  getBuildingRegisterCard, getBuildingRegisterGroups, getNextRegisterVisit, selectBuildingRegister
} from "./helpers";

export interface BuildingRegisterActions {
  /** Closes the register window after a visit. */
  close: () => void;
  /** Focuses a completed building (opens its details window). */
  onFocus: (id: string) => void;
}

/** Cards for every building type; a click visits the type's completed buildings in turn and closes. */
export const useBuildingRegister = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, { close, onFocus }: BuildingRegisterActions
) => {
  const { i18n } = useLingui();
  const { selection: register } = useWindowSelector(
    store, visibility, selectBuildingRegister, isDeepEqual, i18n.locale);
  const visits = useRef(new Map<number, number>());
  return {
    groups: useMemo(() => getBuildingRegisterGroups(register, i18n).map(group => ({
      cards: group.entries.map(entry => getBuildingRegisterCard(entry, i18n)),
      id: group.id,
      label: group.label
    })), [i18n, register]),
    onVisit: (type: number) => {
      const entry = register.find(candidate => candidate.id === type);
      const id = entry && getNextRegisterVisit(entry, visits.current);
      if (id === undefined) return;
      onFocus(id);
      close();
    }
  };
};
