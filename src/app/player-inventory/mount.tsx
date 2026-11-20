import type { PlayerItemId } from "../../shared/progression/player-inventory";
import { mountReactIsland } from "../components/react-island";
import type { ReadableStore } from "../components/ui-store";
import { InventoryPanel } from "./inventory-panel";
import type { InventoryMapKind } from "./map-context";

export const createInventoryMount = (onUse: (item:PlayerItemId) => void, context: ReadableStore<InventoryMapKind>) => (content: HTMLElement) =>
  mountReactIsland(content, <InventoryPanel context={context} onUse={onUse} />);
