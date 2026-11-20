import { describe, expect, it, vi } from "vitest";

import type { CommanderRecoveryRequest } from "../../island-of-settlers-shared/src/commander-recovery";
import { type CommanderRecoveryAnswer,createCommanderRecoveryClient,createCommanderRecoveryTransport } from "../src/app/cloud/commander-recovery-client";

const storage=()=>{
  const values=new Map<string,string>();
  return { values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{ values.set(key,value); },
    removeItem:(key:string)=>{ values.delete(key); } };
};
const receipt=()=>({ ok:true as const,commanderId:"hero",slotId:"slot",revision:8,
  settlement:{ restored:true },wallet:{ gems:50,items:{ chooseNation:1 } } });
const setup=(recover:(body:CommanderRecoveryRequest)=>Promise<CommanderRecoveryAnswer>,saved=storage())=>{
  const apply=vi.fn(),adopt=vi.fn(async(_revision:number,run:()=>void)=>{ run();return { ok:true }; });
  const client=createCommanderRecoveryClient({ accountId:"account",slotId:"slot",storage:saved,
    revision:()=>7,newKey:()=>"same-request-key",adopt,transport:{ recover } });
  return { client,apply,adopt,saved };
};

describe("commander item request authority",()=>{
  it("bounds a stalled request and releases timeout ownership after completed requests",async()=>{
    vi.useFakeTimers();
    try {
      let stalled=true;
      const fetch:typeof globalThis.fetch=async(_input,init)=>{
        if (!stalled) return new Response(JSON.stringify(receipt()),{ status:200 });
        return new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new Error("Aborted")),{ once:true }));
      };
      const transport=createCommanderRecoveryTransport({ apiUrl:"https://example.test",fetch,
        getAccessToken:async()=>"token",leaseId:()=>"lease" });
      const body={ commanderId:"hero",idempotencyKey:"key",revision:7,slotId:"slot" };
      const pending=transport.recover(body).catch((error:unknown)=>error);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toMatchObject({ status:0 });
      expect(vi.getTimerCount()).toBe(0);
      stalled=false;
      for (let index=0;index<50;index++) await transport.recover(body);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("sends the active session lease and exact authority request to the API",async()=>{
    const body={ commanderId:"hero",idempotencyKey:"request-key",revision:7,slotId:"slot" };
    const fetch=vi.fn(async()=>new Response(JSON.stringify(receipt()),{ status:200 }));
    const transport=createCommanderRecoveryTransport({ apiUrl:"https://example.test",fetch,
      getAccessToken:async()=>"access-token",leaseId:()=>"active-lease" });
    expect(await transport.recover(body)).toMatchObject({ ok:true,revision:8 });
    expect(fetch).toHaveBeenCalledWith("https://example.test/v1/economy/items/commander-recovery",
      expect.objectContaining({ method:"POST",body:JSON.stringify(body),headers:expect.objectContaining({
        Authorization:"Bearer access-token","X-Session-Lease":"active-lease"
      }) }));
  });

  it("retries a lost committed response using exactly the same key/body and adopts one effect",async()=>{
    const send=vi.fn().mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(receipt());
    const { adopt,apply,client,saved }=setup(send);
    expect(await client.use("hero",apply)).toMatchObject({ ok:true,reload:false });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
    expect(adopt).toHaveBeenCalledOnce();expect(apply).toHaveBeenCalledOnce();expect(saved.values.size).toBe(0);
  });
  it("preserves unknown confirmation across reload, then acknowledges before loading any old local branch",async()=>{
    const send=vi.fn().mockRejectedValue(new TypeError("offline"));
    const first=setup(send);
    expect(await first.client.use("hero",first.apply)).toMatchObject({ ok:false,pending:true });
    expect(first.saved.values.size).toBe(1);
    const next=setup(vi.fn(async()=>receipt()),first.saved);
    expect(await next.client.reconcile()).toMatchObject({ confirmed:true,receipt:{ revision:8 } });
    expect(next.saved.values.size).toBe(0);expect(next.apply).not.toHaveBeenCalled();
  });
  it("keeps confirmed reload receipts until boot and refuses stale/local application without pretending a refund",async()=>{
    const f=setup(vi.fn(async()=>({ ...receipt(),settlement:null })));
    expect(await f.client.use("hero",f.apply)).toMatchObject({ ok:true,reload:true });
    expect(f.apply).not.toHaveBeenCalled();expect(f.saved.values.size).toBe(1);
    expect(await f.client.reconcile()).toMatchObject({ confirmed:true });
    expect(f.saved.values.size).toBe(0);
  });
  it("does not consume/apply on a domain refusal or an untrusted response",async()=>{
    const refused=setup(vi.fn(async()=>({ ok:false as const,reason:"Active commander" })));
    expect(await refused.client.use("hero",refused.apply)).toMatchObject({ ok:false,reason:"Active commander" });
    expect(refused.saved.values.size).toBe(0);expect(refused.apply).not.toHaveBeenCalled();
    const malformed=setup(vi.fn(async()=>({ ...receipt(),revision:99 })));
    expect(await malformed.client.use("hero",malformed.apply)).toMatchObject({ pending:true });
    expect(malformed.saved.values.size).toBe(1);expect(malformed.apply).not.toHaveBeenCalled();
  });
});
