import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { useExternalStore } from "../components/external-store";
import { usePlayerAvatarSelection } from "../player-avatar/use-player-avatar";
import { CUSTOMIZATION_MESSAGES } from "../settings/customization/messages";
import { playerInventoryView } from "./store";

export interface NationChooserOptions {
  setNation: (nation:WorkerNation)=>Promise<void>;
  onClose: ()=>void;
}

export const useNationChooser = ({ onClose, setNation }:NationChooserOptions) => {
  const { i18n } = useLingui();
  const { nation } = usePlayerAvatarSelection();
  const inventory = useExternalStore(playerInventoryView);
  const [selected,setSelected] = useState<WorkerNation|null>(null);
  const [changing,setChanging] = useState(false);
  const [status,setStatus] = useState("");
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(()=>{
    active.current = true;
    return ()=>{ active.current = false; };
  },[]);
  const confirm = async () => {
    if (busy.current || !selected || selected === nation || !inventory.chooseNation) return;
    busy.current = true; setChanging(true); setStatus(i18n._(CUSTOMIZATION_MESSAGES.changingNation));
    try { await setNation(selected); if (active.current) onClose(); }
    catch (error) {
      let message = CUSTOMIZATION_MESSAGES.changeFailed;
      if (error instanceof Error && error.message === "Nation change is awaiting server confirmation")
        message = CUSTOMIZATION_MESSAGES.changePending;
      if (error instanceof Error && error.message === "Nation change confirmed; reload to finish")
        message = CUSTOMIZATION_MESSAGES.changeConfirmed;
      if (active.current) setStatus(i18n._(message));
    } finally { busy.current = false; if (active.current) setChanging(false); }
  };
  return { i18n, nation, inventory, selected, changing, status, setSelected,
    confirm:()=>{ void confirm(); } };
};
