import type { I18n } from "@lingui/core";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { translateMessage } from "../../shared/i18n/translate";
import { createDefaultPolicy, createLazyReactWindow } from "../components/lazy-react-window";
import { createExternalStore } from "../components/ui-store";
import { INVENTORY_MESSAGES as M } from "./messages";

export const createNationChooserWindow = (
  container:HTMLElement, setNation:(nation:WorkerNation)=>Promise<void>, onReturn:()=>void, i18n?:I18n
) => {
  const openings = createExternalStore(0);
  const chooser = createLazyReactWindow({
    className:"nation-chooser-window",container,contentClassName:"nation-chooser-window__body",i18n,
    heading:()=>translateMessage(i18n,M.chooseNation),id:"nation-chooser-title",
    load:async()=>(await import("./mount-nation-chooser")).createNationChooserMount({
      openings,setNation,onClose:()=>chooser.close()
    }),
    policy:view=>createDefaultPolicy({ ...view,restoreFocus:onReturn }),
    texts:{ error:()=>translateMessage(i18n,M.failed),loading:()=>translateMessage(i18n,M.loading) }
  });
  return { ...chooser,open:()=>{ openings.set(openings.getSnapshot()+1);chooser.open(); } };
};
