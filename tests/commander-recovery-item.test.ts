import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { recoverSavedCommander } from "../src/app/settlement/server-commander-recovery";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { commanderRecoveryProblem, recoverCommander } from "../src/shared/settlement/commander-recovery";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { commanderMaximumHealth } from "../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world=huntingWorld(),roads=createRoadNetwork(world);
  const simulation=createSettlementSimulation({ initialSettlers:20,playerLevel:()=>23,roads,world,
    initialStock:{ beer:40,coins:40,wine:40,planks:40,shield:6,stone:40,sword:6 } });
  const [width,depth]=getBuildingDefinition(62).gridFootprint;
  const placed=simulation.placeBuilding(62,26+width/2,22+depth/2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building,{ construction:1,foundationProgress:1,required:{} });
  roads.addRoad(simulation.headquarters.access,placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  const saved=simulation.saveState(),commander=saved.military!.commander!;
  const soldier=saved.military!.soldiers.find(row=>row.commanderId===commander.id)!;
  const actor=saved.actors.find(row=>row.uid===soldier.actor)!;
  commander.location="recovering";commander.recoverySeconds=1800;commander.healingSeconds=12;
  commander.lastXpResult="already-paid";
  soldier.combat!.hp=1;soldier.combat!.cooldown=4.5;
  actor.phase="commanderRecovering";
  const state={ actors:saved.actors,buildings:saved.buildings,commander,islandSeed:saved.world.seed,
    soldiers:saved.military!.soldiers };
  return { actor,commander,saved,simulation,soldier,state };
};

describe("commander recovery item effect",()=>{
  it("consumes exactly one guest item on success and none for a healthy commander",async()=>{
    const { saved,simulation }=fixture();
    const progress={ ...createPlayerProgress(1),inventory:{ commanderRecovery:1 } };
    const player=createPlayerSession({ initial:progress,seed:1,now:()=>Date.UTC(2026,10,3) });
    player.bind(simulation);
    expect(await player.useCommanderRecovery()).not.toBe(true);
    expect(player.progress().inventory?.commanderRecovery).toBe(1);
    expect(simulation.loadState(saved).ok).toBe(true);
    expect(await player.useCommanderRecovery()).toBe(true);
    expect(player.progress().inventory?.commanderRecovery).toBeUndefined();
    expect(await player.useCommanderRecovery()).not.toBe(true);
    player.dispose();
  });
  it("replays the guest effect but rejects an ordinary server log's paid-effect command",()=>{
    const { saved,simulation }=fixture();
    expect(simulation.loadState(saved).ok).toBe(true);
    const recorder=createCommandLogRecorder(simulation,{ sourceVersion:"recovery" });recorder.open();
    expect(simulation.recoverCommanderWithItem(saved.military!.commander!.id)).toBe(true);
    const interval=recorder.close("home")!;
    const replay=fixture().simulation;
    expect(replay.loadState(saved).ok).toBe(true);
    expect(replayCommandLog(replay,interval)).toMatchObject({ ok:false,
      mismatch:{ kind:"invalid",reason:"Rejected command recoverCommanderWithItem" } });
    expect(replay.loadState(saved).ok).toBe(true);
    expect(replayCommandLog(replay,interval,{ rejectDebug:false }).ok).toBe(true);
    recorder.dispose();
  });

  it("restores full HP and immediate readiness on the same soldier and horse without resetting XP/cooldowns",()=>{
    const { commander,saved,simulation,soldier,state }=fixture();
    const actorIds=saved.actors.map(row=>row.uid),mount=soldier.combat!.mount;
    expect(commanderRecoveryProblem(state,commander.id)).toBeNull();
    expect(recoverCommander(state,commander.id)).toBe(true);
    expect(soldier.combat!.hp).toBe(commanderMaximumHealth(commander.level));
    expect(soldier.combat!.cooldown).toBe(4.5);
    expect(commander).toMatchObject({ recoverySeconds:0,location:"lodge",xp:0,lastXpResult:"already-paid" });
    expect(saved.actors.map(row=>row.uid)).toEqual(actorIds);
    expect(soldier.combat!.mount).toBe(mount);
    expect(simulation.loadState(saved)).toEqual({ ok:true });
    expect(simulation.commanderSnapshot()).toMatchObject({ ready:true,healthReady:true,recoveryComplete:true });
    expect(recoverCommander(state,commander.id)).not.toBe(true);
  });
  it("returns a defeated commander already being evacuated to the same home lodge",()=>{
    const { actor,commander,soldier,state }=fixture();
    commander.location="travelling";soldier.combat!.hp=0;actor.phase="commanderEvacuating";
    expect(recoverCommander(state,commander.id)).toBe(true);
    expect(actor).toMatchObject({ phase:"commanderLodge",visible:false,path:[] });
    expect(soldier.combat!.hp).toBe(commanderMaximumHealth(commander.level));
  });
  it.each(["field","away","aboard","lodge","travelling"] as const)("rejects %s without mutating anything",location=>{
    const { commander,saved,state }=fixture();commander.location=location;
    const before=structuredClone(saved);
    expect(recoverCommander(state,commander.id)).not.toBe(true);
    expect(saved).toEqual(before);
  });
  it("rejects wrong identities, foreign soldiers, missing homes and commanders away from home",()=>{
    for (const change of [
      (f:ReturnType<typeof fixture>)=>{ f.state.islandSeed++; },
      (f:ReturnType<typeof fixture>)=>{ f.commander.homeLodgeUid=-1; },
      (f:ReturnType<typeof fixture>)=>{ f.soldier.combat!.faction=1; }
    ]) {
      const f=fixture();change(f);const before=structuredClone(f.saved);
      expect(recoverCommander(f.state,f.commander.id)).not.toBe(true);
      expect(f.saved).toEqual(before);
    }
    const f=fixture();expect(recoverCommander(f.state,"different-commander")).not.toBe(true);
  });
  it("processes a separate server copy and never mutates a refused or accepted input document",()=>{
    const { commander,saved }=fixture();
    const game={ format:"island-settlers-game",settlement:saved } as GameSaveV1;
    const before=structuredClone(game);
    expect(recoverSavedCommander(game,"different-commander")).toMatchObject({ ok:false });
    const result=recoverSavedCommander(game,commander.id);
    expect(result).toMatchObject({ ok:true });
    expect(game).toEqual(before);
    expect(result?.ok && result.game.settlement.military!.commander!.location).toBe("lodge");
  });
});
