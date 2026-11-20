import { createComponentMount } from "../../components/react-island";
import type { OpenRequestStore } from "../open-request";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { QuestBook } from "./quest-book";
import type { QuestBookOptions } from "./use-quest-book";

/** Mounter for `createLazyReactContent`: the quest book loads with React on the window's first open. */
export const createQuestBookMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, request: OpenRequestStore,
  options: QuestBookOptions
) => createComponentMount(QuestBook, { options, request, store, visibility });
