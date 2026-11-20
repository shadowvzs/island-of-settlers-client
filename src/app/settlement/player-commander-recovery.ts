import { consumePersonalItem } from "../../shared/progression/personal-item-purchase";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { PlayerRecoveryResult } from "./commander-recovery-session";

interface Options {
  active:()=>boolean;
  busy:()=>boolean;
  commit:(progress:PlayerProgress)=>unknown;
  get:()=>PlayerProgress;
  localize:(text:string)=>string;
  online:boolean;
  recover?: (id:string)=>Promise<PlayerRecoveryResult>;
  refresh:()=>PlayerProgress;
  setBusy:(busy:boolean)=>void;
  simulation:()=>SettlementSimulation|undefined;
}
export const createPlayerCommanderRecovery = (options:Options)=>async():Promise<true|string>=>{
  const { active,busy,commit,get,localize,online,recover,refresh,setBusy }=options;
  if (busy() || !active()) return localize("Another inventory action is in progress");
  if (!refresh().inventory?.commanderRecovery) return localize("A Commander recovery item is required");
  const simulation=options.simulation(),id=simulation?.commanderState()?.id;
  if (!id || simulation?.islandRole() !== "home") return localize("Return to the commander's home island first");
  const problem=simulation.commanderRecoveryProblem(id);
  if (problem) return localize(problem);
  setBusy(true);
  try {
    if (online) {
      if (!recover) return localize("Commander recovery is unavailable");
      const result=await recover(id);
      if (!result.ok) return localize(result.reason);
      if (!active()) return localize("The island is no longer active");
      commit({ ...get(),gems:result.gems,inventory:result.items });
      return true;
    }
    const result=simulation.recoverCommanderWithItem(id);
    if (result !== true) return localize(result);
    const consumed=consumePersonalItem(get(),"commanderRecovery");
    if (!consumed) return localize("A Commander recovery item is required");
    commit(consumed);return true;
  } finally { setBusy(false); }
};
