import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { useExternalStore } from "../../components/external-store";
import { useStoreSelector } from "../../components/use-store-selector";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import {
  getSummaryPeopleView, getSummaryResourceRows, isSameSummaryPeople, isSameSummaryResources,
  selectSummaryPeople, selectSummaryResources
} from "./helpers";

/** Goods and people tiles; recomputed only while the window is visible and the values change. */
export const useSettlementSummary = (store: SettlementUiStore, visibility: SettlementWindowVisibilityStore) => {
  const { i18n } = useLingui();
  const { visible } = useExternalStore(visibility);
  const people = useStoreSelector(store, selectSummaryPeople, isSameSummaryPeople, visible, i18n.locale);
  const resources = useStoreSelector(store, selectSummaryResources, isSameSummaryResources, visible, i18n.locale);
  return {
    people: useMemo(() => getSummaryPeopleView(people, i18n), [i18n, people]),
    resources: useMemo(() => getSummaryResourceRows(resources, i18n), [i18n, resources])
  };
};
