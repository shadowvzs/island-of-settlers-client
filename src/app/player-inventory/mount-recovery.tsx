import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";

import { useExternalStore } from "../components/external-store";
import { mountReactIsland } from "../components/react-island";
import type { ReadableStore } from "../components/ui-store";
import { PlayerItemIcon } from "./item-icon";
import { INVENTORY_MESSAGES as M } from "./messages";
import type { CommanderRecoveryControl } from "./recovery-window";
import { playerInventoryView } from "./store";

interface Options { control:CommanderRecoveryControl;onClose:()=>void }
const useRecovery = ({ control,onClose }:Options) => {
  const { i18n }=useLingui();
  const [status]=useState(control.status);
  const [changing,setChanging]=useState(false),[message,setMessage]=useState("");
  const inventory=useExternalStore(playerInventoryView);
  const active=useRef(true),busy=useRef(false);
  useEffect(()=>{ active.current=true;return()=>{ active.current=false; }; },[]);
  const confirm=async()=>{
    if (busy.current || !inventory.commanderRecovery || !status || status.blocked) return;
    busy.current=true;setChanging(true);setMessage(i18n._(M.recoveryWorking));
    try {
      const result=await control.use();
      if (!active.current) return;
      if (result === true) onClose();
      else if (result.includes("verified")) setMessage(i18n._(M.recoveryVerification));
      else setMessage(i18n._(M.recoveryFailed));
    } catch { if (active.current) setMessage(i18n._(M.recoveryFailed)); }
    finally { busy.current=false;if (active.current) setChanging(false); }
  };
  let detail="";
  if (status) detail=i18n._({ ...M.recoveryTarget,values:{ name:status.name,hp:Math.ceil(status.hp),maximum:Math.ceil(status.maximum) } });
  return { description:i18n._(M.recoveryDescription),blockedText:i18n._(M.recoveryBlocked),
    blocked:!status || status.blocked,changing,message,
    detail,
    cancel:i18n._(M.cancel),confirm:i18n._(M.confirm),disabled:changing || !status || status.blocked || !inventory.commanderRecovery,
    submit:()=>{ void confirm(); } };
};
const RecoveryPanel = ({ onClose,...options }:Options) => {
  const model=useRecovery({ ...options,onClose });
  return (
    <div className="commander-recovery-panel">
      <PlayerItemIcon item="commanderRecovery" />
      <p>{model.description}</p>
      <strong>{model.detail}</strong>
      {model.blocked && <p>{model.blockedText}</p>}
      <p hidden={!model.message} role="status">{model.message}</p>
      <div className="nation-chooser__actions">
        <button className="settlement-ui__button" disabled={model.changing} type="button" onClick={onClose}>{model.cancel}</button>
        <button className="settlement-ui__button" disabled={model.disabled} type="button" onClick={model.submit}>{model.confirm}</button>
      </div>
    </div>
  );
};
const RecoveryMount = ({ openings,...options }:Options & { openings:ReadableStore<number> }) => {
  const opening=useExternalStore(openings);
  return <RecoveryPanel key={opening} {...options} />;
};
export const createRecoveryMount = (options:Options & { openings:ReadableStore<number> })=>(content:HTMLElement)=>
  mountReactIsland(content,<RecoveryMount {...options} />);
