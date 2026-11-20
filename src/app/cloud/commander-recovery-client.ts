import type { CommanderRecoveryReceipt, CommanderRecoveryRequest } from "../../../../island-of-settlers-shared/src/commander-recovery";
import { validPlayerInventory } from "../../../../island-of-settlers-shared/src/player-inventory";
import { PREFERENCE_FAMILIES } from "../preferences/keys";
import { createApiTransport, readApiError, SaveApiError, type SaveApiOptions } from "../save-store/save-api-client";

export type CommanderRecoveryAnswer = ({ ok:true } & CommanderRecoveryReceipt) |
  { code?:string;ok:false;reason:string };
export interface RecoveryTransport { recover:(body:CommanderRecoveryRequest)=>Promise<CommanderRecoveryAnswer> }

/** A world mutation carries the same active-session lease as saving and Market stock moves. */
export const createCommanderRecoveryTransport = (options:SaveApiOptions & { leaseId:()=>string|undefined }):RecoveryTransport => {
  const request=options.fetch ?? globalThis.fetch;
  const boundedFetch:typeof fetch=async(input,init)=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20_000);
    try { return await request(input,{ ...init,signal:controller.signal }); }
    finally { clearTimeout(timeout); }
  };
  const { send }=createApiTransport({ ...options,fetch:boundedFetch });
  return { recover:async body=>{
    const response=await send("POST","/v1/economy/items/commander-recovery",{ body,lease:options.leaseId() });
    if (response.status === 409) {
      const error=await readApiError(response);
      return { ok:false,code:error.code,reason:error.message };
    }
    if (!response.ok) throw await readApiError(response);
    return { ok:true,...await response.json() as CommanderRecoveryReceipt };
  } };
};

interface StoragePort { getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void }
interface RecoveryClientOptions {
  accountId:string;
  adopt:(revision:number,apply:()=>void)=>Promise<{ ok:boolean }>;
  newKey?:()=>string;
  revision:()=>number|null;
  slotId:string;
  storage:StoragePort;
  transport:RecoveryTransport;
}
export type RecoveryOutcome = { ok:true;receipt:CommanderRecoveryReceipt;reload:boolean } |
  { ok:false;reason:string;pending?:boolean };
const PENDING="Commander recovery is awaiting server confirmation";

/** The exact request survives a lost response/reload. A later purchase never inherits its old receipt. */
export const createCommanderRecoveryClient = ({ accountId,adopt,newKey=()=>crypto.randomUUID(),revision,
  slotId,storage,transport }:RecoveryClientOptions) => {
  const key=`${PREFERENCE_FAMILIES.inventoryRequest.prefix}${accountId}:${slotId}:commander`;
  let busy=false;
  const pending = ():CommanderRecoveryRequest|null=>{
    const raw=storage.getItem(key);
    if (!raw) return null;
    try {
      const value=JSON.parse(raw) as CommanderRecoveryRequest;
      if (value.slotId === slotId && typeof value.commanderId === "string" && value.commanderId &&
          typeof value.idempotencyKey === "string" && value.idempotencyKey && Number.isSafeInteger(value.revision) && value.revision>=1)
        return value;
    } catch { /* An invalid local key cannot authorize a server mutation. */ }
    storage.removeItem(key);return null;
  };
  const validReceipt = (answer:CommanderRecoveryReceipt,request:CommanderRecoveryRequest) =>
    answer.slotId === slotId && answer.commanderId === request.commanderId && answer.revision === request.revision+1 &&
    Number.isSafeInteger(answer.wallet?.gems) && answer.wallet.gems >= 0 && answer.wallet.items !== undefined && validPlayerInventory(answer.wallet.items);
  const execute = async (request:CommanderRecoveryRequest,retry:boolean,onAmbiguous?:()=>void):Promise<CommanderRecoveryAnswer>=>{
    try { return await transport.recover(request); }
    catch (error) {
      if (!retry || (error instanceof SaveApiError && error.status>=400 && error.status<500)) throw error;
      onAmbiguous?.();
      return transport.recover(request);
    }
  };
  return {
    /** Run before offering a newer local branch on boot: a confirmed paid world effect wins that branch. */
    reconcile:async()=>{
      const request=pending();if (!request) return { confirmed:false };
      const answer=await execute(request,false);
      if (!answer.ok) {
        if (answer.code === "SESSION_LEASE_LOST") throw new Error(PENDING);
        storage.removeItem(key);return { confirmed:false };
      }
      if (!validReceipt(answer,request)) throw new Error(PENDING);
      storage.removeItem(key);
      return { confirmed:true,receipt:answer };
    },
    use:async(commanderId:string,apply:(settlement:unknown)=>void):Promise<RecoveryOutcome>=>{
      if (busy) return { ok:false,reason:"Another inventory action is in progress" };
      const previous=pending();
      if (previous && previous.commanderId !== commanderId) return { ok:false,pending:true,reason:PENDING };
      const current=revision();
      if (current === null || current<1) return { ok:false,reason:"Save the home island before using this item" };
      const request=previous ?? { commanderId,idempotencyKey:newKey(),revision:current,slotId };
      storage.setItem(key,JSON.stringify(request));
      busy=true;
      let uncertain=Boolean(previous);
      try {
        const answer=await execute(request,true,()=>{ uncertain=true; });
        if (!answer.ok) {
          if (uncertain && answer.code === "SESSION_LEASE_LOST") return { ok:false,pending:true,reason:PENDING };
          storage.removeItem(key);return answer;
        }
        if (!validReceipt(answer,request)) return { ok:false,pending:true,reason:PENDING };
        let reload=answer.settlement == null;
        if (!reload) {
          try { reload=!(await adopt(answer.revision,()=>apply(answer.settlement))).ok; }
          catch { reload=true; }
        }
        if (!reload) storage.removeItem(key);
        return { ok:true,receipt:answer,reload };
      } catch (error) {
        // An explicit first-attempt domain refusal is safe; transport/parse failures may follow a commit.
        if (!uncertain && error instanceof SaveApiError && error.status>=400 && error.status<500) {
          storage.removeItem(key);return { ok:false,reason:error.message };
        }
        return { ok:false,pending:true,reason:PENDING };
      } finally { busy=false; }
    }
  };
};
export type CommanderRecoveryClient=ReturnType<typeof createCommanderRecoveryClient>;
