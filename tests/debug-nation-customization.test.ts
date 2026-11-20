import { describe, expect, it, vi } from "vitest";

import { createIslandSettings } from "../src/app/island-settings";
import { createSettingsPanel } from "../src/app/settings/settings-panel";
import { createPlayerSession } from "../src/app/settlement/player-session";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

vi.mock("../src/app/hud-theme",()=>({ createHudThemeToggle:()=>({ dispose:vi.fn() }) }));
vi.mock("../src/app/settings/settings-panel",()=>({
  createSettingsPanel:vi.fn(()=>({ cornerRow:{},dispose:vi.fn() }))
}));

const fixture = (owned: boolean, development = true) => {
  const player = createPlayerSession({ initial:{ ...createPlayerProgress(1),gems:200,
    inventory:owned?{ chooseNation:1 }:{} },seed:1,now:()=>Date.UTC(2026,10,3) });
  let nation: WorkerNation = "roman";
  const debug = vi.fn((next: WorkerNation)=>{ nation=next;return true; });
  const ordinary = vi.fn((next: WorkerNation)=>{ nation=next;return true; });
  const settlement = { playerSession:player,setPlayerAppearances:vi.fn(),simulation:{
    playerNation:()=>nation,canSetPlayerNation:()=>true,debugSetPlayerNation:debug,setPlayerNation:ordinary
  } };
  const prepared = { commit:vi.fn(()=>true),dispose:vi.fn() };
  createIslandSettings({} as never,{
    camera:{},development,getSettlement:()=>settlement,loading:{ setNation:vi.fn() },minimap:{ refresh:vi.fn() },
    renderer:{ prepareWorkerAppearances:vi.fn(async()=>prepared) },workerNation:"roman",
    workers:{ frames:[{ nation:"roman",variant:"roman-man-white" }] },world:{ cellsX:48,cellsZ:48 }
  } as never);
  const options = vi.mocked(createSettingsPanel).mock.calls.at(-1)![1];
  return { debug,nation:()=>nation,options,ordinary,player,prepared };
};

describe("separate paid and authorized debug nation changes",()=>{
  it.each([false,true])("debug switches with owned=%s without consuming or charging",async owned=>{
    const { debug,nation,options,ordinary,player } = fixture(owned);
    const before = structuredClone(player.progress().inventory);
    await options.setDebugWorkerNation!("persian");
    expect(nation()).toBe("persian");
    expect(debug).toHaveBeenCalledWith("persian");
    expect(ordinary).not.toHaveBeenCalled();
    expect(player.progress().inventory).toEqual(before);
    expect(player.progress().gems).toBe(200);
    player.dispose();
  });
  it("normal customization still refuses without an item and consumes on a successful switch",async()=>{
    const locked = fixture(false);
    await expect(locked.options.setWorkerNation("persian")).rejects.toThrow("Choose nation item");
    expect(locked.nation()).toBe("roman"); expect(locked.debug).not.toHaveBeenCalled();
    locked.player.dispose();
    const paid = fixture(true);
    await paid.options.setWorkerNation("maya");
    expect(paid.nation()).toBe("maya"); expect(paid.ordinary).toHaveBeenCalledWith("maya");
    expect(paid.player.progress().inventory).toEqual({}); expect(paid.debug).not.toHaveBeenCalled();
    paid.player.dispose();
  });
  it("refuses a debug callback when existing development access is disabled",async()=>{
    const { debug,options,player,prepared } = fixture(true,false);
    await expect(options.setDebugWorkerNation!("persian")).rejects.toThrow("Development access");
    expect(debug).not.toHaveBeenCalled(); expect(prepared.commit).not.toHaveBeenCalled();
    expect(player.progress().inventory).toEqual({ chooseNation:1 });
    player.dispose();
  });
});
