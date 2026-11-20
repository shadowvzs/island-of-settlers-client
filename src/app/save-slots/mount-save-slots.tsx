import { useExternalStore } from "../components/external-store";
import { mountReactIsland } from "../components/react-island";
import type { ReadableStore } from "../components/ui-store";
import { SaveSlots } from "./save-slots-view";
import type { SaveSlotsWindowState } from "./save-slots-window";
import type { SaveSlotsControls } from "./slot-actions";

interface SaveSlotsMountProps {
  controls: SaveSlotsControls;
  state: ReadableStore<SaveSlotsWindowState>;
}
/** The window's list in the opened mode; every opening starts a fresh list (read again, no stale question). */
const SaveSlotsMount = ({ controls, state }: SaveSlotsMountProps) => {
  const { mode, opening } = useExternalStore(state);
  return <SaveSlots controls={controls} key={opening} mode={mode} />;
};

/** The Save/Load window's lazy content. */
export const createSaveSlotsMount = (controls: SaveSlotsControls, state: ReadableStore<SaveSlotsWindowState>) =>
  (content: HTMLElement) => mountReactIsland(content, <SaveSlotsMount controls={controls} state={state} />);
