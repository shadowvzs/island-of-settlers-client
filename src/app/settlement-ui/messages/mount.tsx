import { createComponentMount } from "../../components/react-island";
import type { OpenRequestStore } from "../open-request";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { Messages } from "./message-view";

/** Mounter for `createLazyReactContent`: the inbox loads with React on the window's first open. */
export const createMessagesMount = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, request: OpenRequestStore,
  onReadMessage?: (id: string) => void
) => createComponentMount(Messages, { request, store, visibility, onReadMessage });
