import type { I18n } from "@lingui/core";

import { isRoadDecorationItemId, type RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createInventoryWindow } from "./inventory-window";
import type { InventoryMapKind } from "./map-context";
import { createNationChooserWindow } from "./nation-chooser-window";
import { type CommanderRecoveryControl, createRecoveryWindow } from "./recovery-window";

interface Options {
  container: HTMLElement;
  i18n?: I18n;
  recovery?: CommanderRecoveryControl;
  mapKind: () => InventoryMapKind;
  placeDecoration?: (item: RoadDecorationItemId) => void;
  refresh?: () => Promise<void>;
  setNation?: (nation: WorkerNation) => Promise<void>;
}
/** One inventory owner for every map; selection shortcuts no longer create its windows. */
export const createPlayerInventoryControls = ({
  container, i18n, mapKind, placeDecoration, recovery, refresh, setNation
}: Options) => {
  const focusItem = (id: string) => {
    const target = inventory.root.querySelector<HTMLElement>(`[data-item-id="${id}"]`) ??
      inventory.root.querySelector<HTMLElement>(".settlement-ui__drag-handle");
    target?.focus();
  };
  const inventory = createInventoryWindow(container, item => {
    if (item === "chooseNation") { chooser?.open(); return; }
    if (isRoadDecorationItemId(item)) {
      if (placeDecoration) { inventory.close(); placeDecoration(item); }
      return;
    }
    if (item === "commanderRecovery") recoveryWindow?.open();
  }, i18n, mapKind);
  const chooser = setNation && createNationChooserWindow(container, setNation,
    () => focusItem("chooseNation"), i18n);
  const recoveryWindow = recovery && createRecoveryWindow(container, recovery,
    () => focusItem("commanderRecovery"), i18n);
  return {
    close: () => inventory.close(),
    open: (opener?: HTMLElement) => {
      inventory.registerOpener(opener ?? null);
      void refresh?.();
      inventory.open();
    },
    dispose: () => { recoveryWindow?.dispose(); chooser?.dispose(); inventory.dispose(); }
  };
};
