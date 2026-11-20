import { copyGameSlot } from "../app/save-slots/slot-copy";
import { buildSlotDumpUpload, importSlotDump } from "../app/save-slots/slot-dump";
import { completeSnapshotBody, persistCapturedGame } from "../app/save-store/captured-game";
import { rethemeExpedition } from "../app/settlement/expedition-retheme";
import { openGameDatabase } from "../app/settlement/game-database";
import { stageGameSession } from "../app/settlement/game-session";
import type { GameSessionRequest, GameSessionResponse } from "../app/settlement/game-session-worker";
import type { OfflineEconomyMetrics } from "../app/settlement/offline-economy";
import type { OfflineIslandMetrics } from "../app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../app/settlement/offline-progress";
import { createGameSave } from "../shared/settlement/game-save";
import {
  clearSaveStageProfile, readSaveStageProfile
} from "../shared/settlement/save-stage-profile";
import { getWorldTransferables } from "../shared/world/world-data";

const scope = self as unknown as { onmessage: ((event: MessageEvent<GameSessionRequest>) => void) | null;
  postMessage(message: GameSessionResponse, transfer?: Transferable[]): void };
scope.onmessage = async ({ data }) => {
  try {
    if (data.kind === "theme") {
      scope.postMessage({ id: data.id, value: await rethemeExpedition(data.value, data.theme) }); return;
    }
    if (data.kind === "offline") {
      const metrics: OfflineIslandMetrics[] = [], economy: OfflineEconomyMetrics[] = [], started = performance.now();
      const save = await advanceOfflineGame(data.value, data.now,
        progress => scope.postMessage({ id: data.id, progress }),
        data.metrics ? { ...data.options, onIslandMetrics: entry => metrics.push(entry),
          onEconomyMetrics: entry => economy.push(entry) } : data.options);
      const value = data.metrics ? { economy, metrics, save, wallMs: 0, workerWallMs: performance.now() - started } : save;
      scope.postMessage({ id: data.id, value }); return;
    }
    if (data.kind === "persist") {
      const profileFlag = globalThis as { __saveStageProfile?: boolean };
      const previous = profileFlag.__saveStageProfile;
      if (data.profile) {
        clearSaveStageProfile();
        profileFlag.__saveStageProfile = true;
      }
      try {
        const value = await persistCapturedGame(data.captured, data.target, await openGameDatabase());
        const stages = data.profile ? readSaveStageProfile().map(sample => ({
          name: `worker.${sample.name}`, ms: sample.ms
        })) : undefined;
        scope.postMessage({ id: data.id, value, ...(stages ? { stages } : {}) }, value ? [value.body] : []);
      } finally {
        if (data.profile) {
          if (previous === undefined) delete profileFlag.__saveStageProfile;
          else profileFlag.__saveStageProfile = previous;
        }
      }
      return;
    }
    if (data.kind === "complete") {
      const value = await completeSnapshotBody(data.recoverySlotId, data.keys);
      scope.postMessage({ id: data.id, value }, [value.body]); return;
    }
    if (data.kind === "copySlot") {
      await copyGameSlot(await openGameDatabase(), data.request);
      scope.postMessage({ id: data.id, value: null }); return;
    }
    if (data.kind === "exportSlot") {
      const value = await buildSlotDumpUpload(await openGameDatabase(), data.slotId, data.meta);
      scope.postMessage({ id: data.id, value }, [value.body]); return;
    }
    if (data.kind === "importSlot") {
      scope.postMessage({ id: data.id, value: await importSlotDump(await openGameDatabase(), data.slotId, data.json) });
      return;
    }
    if (data.kind === "save") {
      scope.postMessage({ id: data.id, value: await createGameSave(...data.arguments) }); return;
    }
    const value = await stageGameSession(typeof data.value === "string" ? JSON.parse(data.value) : data.value);
    const { terrain, world } = value.map;
    const transfer = new Set(getWorldTransferables(world));
    if (world.lakeWater) transfer.add(world.lakeWater.buffer as ArrayBuffer);
    if (terrain) for (const view of [terrain.lake, terrain.ring, terrain.rise,
      terrain.base?.heights, terrain.base?.splat, terrain.base?.waterSurface])
      if (view) transfer.add(view.buffer as ArrayBuffer);
    scope.postMessage({ id: data.id, value }, [...transfer]);
  } catch (error) { scope.postMessage({ id: data.id,
    error: error instanceof Error ? error.message : "Invalid saved game" }); }
};
