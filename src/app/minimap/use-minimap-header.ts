import { type ExternalStore,useExternalStore } from "../components/external-store";

/** Territory toggle of the minimap header: the store is read by the imperative canvas redraw. */
export const useMinimapHeader = (territory: ExternalStore<boolean>) => {
  const shown = useExternalStore(territory);
  return { shown, onToggle: () => territory.set(!territory.getSnapshot()) };
};
