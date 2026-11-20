import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { createDefaultPolicy, createLazyReactWindow } from "../components/lazy-react-window";
import { createExternalStore } from "../components/ui-store";
import { INVENTORY_MESSAGES as M } from "./messages";

export interface CommanderRecoveryControl {
  status:()=>{ blocked:boolean;hp:number;maximum:number;name:string }|null;
  use:()=>Promise<true|string>;
}
export const createRecoveryWindow = (container:HTMLElement,control:CommanderRecoveryControl,
  onReturn:()=>void,i18n?:I18n) => {
  const openings=createExternalStore(0);
  const window=createLazyReactWindow({ className:"commander-recovery-window",container,i18n,
    contentClassName:"commander-recovery-window__body",heading:()=>translateMessage(i18n,M.recoveryName),
    id:"commander-recovery-title",policy:view=>createDefaultPolicy({ ...view,restoreFocus:onReturn }),
    load:async()=>(await import("./mount-recovery")).createRecoveryMount({ control,openings,onClose:()=>window.close() }),
    texts:{ error:()=>translateMessage(i18n,M.failed),loading:()=>translateMessage(i18n,M.loading) } });
  return { ...window,open:()=>{ openings.set(openings.getSnapshot()+1);window.open(); } };
};
