import { describe, expect, it, vi } from "vitest";

import type { CloudSession } from "../src/app/cloud/cloud-boot";
import type { SaveCoordinator } from "../src/app/save-store/save-coordinator";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createCommanderRecoverySession } from "../src/app/settlement/commander-recovery-session";
import type { IslandSettlement } from "../src/app/settlement/island-settlement";

const setup=()=>{
  const events:string[]=[];
  const lifecycle=createSessionLifecycle({ onFrozen:frozen=>events.push(`frozen:${frozen}`) });
  const simulation={ home:()=>({ typeId:0 }),islandRole:()=>"home",commanderRecoveryProblem:()=>null,
    loadState:vi.fn(()=>{ events.push("apply");return { ok:true }; }) };
  const settlement={ simulation,bugReplay:{ recording:()=>false } } as unknown as IslandSettlement;
  let current:IslandSettlement|undefined=settlement;
  const saving={ flushTransition:vi.fn(async(alive:()=>boolean)=>{ expect(alive()).toBe(true);events.push("save");return true; }),
    whenIdle:async()=>undefined,stop:vi.fn() } as unknown as SaveCoordinator;
  const cloud={ store:{ whenIdle:async()=>undefined,hasPendingUpload:()=>false,revision:()=>7 },
    verification:{ afterUpload:async()=>{ events.push("verify");return { verifiedRevision:7 }; } },
    recovery:{ use:vi.fn(async(_id:string,apply:(state:unknown)=>void)=>{
      events.push("request");apply({ healed:true });
      return { ok:true,receipt:{ wallet:{ items:{ chooseNation:1 },gems:50 } },reload:false };
    }) },discardUnsent:vi.fn(async()=>undefined) } as unknown as CloudSession;
  const reload=vi.fn(),rebase=vi.fn(()=>{ events.push("rebase"); });
  const use=createCommanderRecoverySession({ cloud,getSettlement:()=>current,lifecycle,saving,rebase,reload,settle:async()=>undefined });
  return { use,events,lifecycle,simulation,saving,cloud,reload,remove:()=>{ current=undefined; } };
};

describe("held commander recovery transaction",()=>{
  it("holds ticks/commands before the exact save, verifies, applies and rebases before releasing",async()=>{
    const f=setup();
    expect(await f.use("hero")).toEqual({ ok:true,items:{ chooseNation:1 },gems:50 });
    expect(f.events).toEqual(["frozen:true","save","verify","request","apply","rebase","frozen:false"]);
    expect(f.reload).not.toHaveBeenCalled();
  });
  it("never requests or applies into a disposed scene",async()=>{
    const f=setup();
    vi.spyOn(f.cloud.verification,"afterUpload").mockImplementation(async()=>{ f.remove();return { flag:null,flaggedAt:null,revision:7,pending:false,verifiedRevision:7 }; });
    expect(await f.use("hero")).toMatchObject({ ok:false });
    expect(f.cloud.recovery.use).not.toHaveBeenCalled();expect(f.simulation.loadState).not.toHaveBeenCalled();
  });
  it("keeps an uncertain server commit frozen and stops old saves while reloading for receipt reconciliation",async()=>{
    const f=setup();
    vi.spyOn(f.cloud.recovery,"use").mockResolvedValue({ ok:false,pending:true,reason:"Pending" });
    expect(await f.use("hero")).toMatchObject({ ok:false,reason:"Commander recovery is awaiting server confirmation" });
    expect(f.saving.stop).toHaveBeenCalledOnce();expect(f.reload).toHaveBeenCalledOnce();
    expect(f.events).not.toContain("frozen:false");
    expect(f.lifecycle.generation()).toBe(1);
  });
});
