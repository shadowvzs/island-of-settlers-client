import { useState } from "react";

import { isDeepEqual } from "../../components/ui-store";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import { selectBuildingDetails } from "./helpers";
import type { StorageCollectTool,StoragePage } from "./storage-helpers";
import { INITIAL_TAVERN_DRAFT, type TavernDraft } from "./tavern-helpers";

/** Panel-local choices of one building: storage page and tool, Tavern order draft. */
interface BuildingDrafts {
  id?: string;
  page: StoragePage;
  tavern: TavernDraft;
  tool: StorageCollectTool;
}

const initialDrafts = (id?: string): BuildingDrafts =>
  ({ id, page: "resources", tavern: INITIAL_TAVERN_DRAFT, tool: null });

/**
 * Drafts that survive every snapshot tick but start over once another building is focused (derived
 * from the id while rendering, so the first frame of the new building already shows the defaults).
 */
const useBuildingDrafts = (id?: string) => {
  const [stored, setStored] = useState(() => initialDrafts(id));
  const drafts = stored.id === id ? stored : initialDrafts(id);
  // Render-phase reset: returning to the previous building later starts from the defaults too.
  if (stored !== drafts) setStored(drafts);
  const update = (patch: Partial<BuildingDrafts>) => setStored({ ...drafts, ...patch });
  return {
    drafts,
    setPage: (page: StoragePage) => update({ page }),
    setTavern: (tavern: TavernDraft) => update({ tavern }),
    setTool: (tool: StorageCollectTool) => update({ tool })
  };
};

export type BuildingDraftState = ReturnType<typeof useBuildingDrafts>;

/** Focused building and context; computed only while the window is visible and the slice changes. */
export const useBuildingDetails = (store: SettlementUiStore, visibility: SettlementWindowVisibilityStore) => {
  const { selection: data, visible } = useWindowSelector(store, visibility, selectBuildingDetails, isDeepEqual);
  return { data, drafts: useBuildingDrafts(data.building?.id), visible };
};
