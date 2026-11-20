import { createExternalStore, type ExternalStore } from "../../components/ui-store";
import {
  addCornerButton, type CornerButton, type CornerButtonSpec, type CornerButtonState, updateCornerButton
} from "./helpers";

export type CornerRowStore = ExternalStore<readonly CornerButton[]>;

/**
 * The top right icon row: owners add their buttons and change their state through a React-free store; the
 * corner's React root (`corner-panel.ts`) renders them. Panels, popovers and their open/close rules stay with
 * their owners.
 */
export const createCornerRow = () => {
  const store: CornerRowStore = createExternalStore<readonly CornerButton[]>([]);
  return {
    add: (spec: CornerButtonSpec, state: CornerButtonState = {}, position: "end" | "start" = "end") => {
      store.set(addCornerButton(store.getSnapshot(), { ...spec, ...state }, position));
    },
    remove: (id: string) => store.set(store.getSnapshot().filter(button => button.id !== id)),
    store,
    update: (id: string, changes: CornerButtonState) => {
      store.set(updateCornerButton(store.getSnapshot(), id, changes));
    }
  };
};

export type CornerRow = ReturnType<typeof createCornerRow>;
