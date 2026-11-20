import type { I18n } from "@lingui/core";

import { translateMessage } from "../shared/i18n/translate";
import type { GameSaveV1 } from "../shared/settlement/game-save";
import { markFogChanged } from "../shared/world/fog-revision";
import { FOG, type WorldData } from "../shared/world/world-data";
import { adminSettingsUrl, mapEditorUrl } from "./admin-links";
import type { ExternalStore } from "./components/ui-store";
import { type DevelopmentAccess } from "./development-access";
import { downloadJson } from "./helpers";
import type { SaveStore } from "./save-store/save-store";
import type { SceneReplayRuntime } from "./scene-replay/runtime";
import { createDevelopmentTool, createIconTool } from "./settings/development/development-tool";
import type { DevelopmentGroup, DevelopmentTool } from "./settings/development/helpers";
import { DEVELOPMENT_MESSAGES as M } from "./settings/development/messages";
import { createNpcTradersTool } from "./settings/development/npc-traders-tool";
import { createExpeditionDiscoveryDebug } from "./settings/expedition-discovery-debug";
import type { IslandSettlement } from "./settlement/island-settlement";
import type { MilitaryAiDebug } from "./settlement/military-ai-debug";
import type { MilitaryDebugControls } from "./settlement/military-debug/helpers";
import { getSettlementIconSource } from "./settlement-ui/icons";
import { progressionIcon } from "./settlement-ui/player-hud-helpers";

/** Development menu gem grant, for testing the gem shop. */
const DEVELOPMENT_GEM_GRANT = 500;
/** Development menu gold coin grant, for testing coin costs such as soldier training. */
const DEVELOPMENT_COIN_GRANT = 2000;
/** The previous island's reproduction report, kept when an island visit ends the recording. */

type ExpeditionTheme = NonNullable<Parameters<typeof createExpeditionDiscoveryDebug>[0]>["currentTheme"];

/** Development actions bound once the settlement (and its save controller) exists. */
interface DevelopmentToolHooks {
  applyExpeditionTheme?: (theme: NonNullable<ExpeditionTheme>) => Promise<void>;
  captureReplayBaseline?: () => Promise<GameSaveV1>;
  clearSaves?: () => Promise<void>;
  exportMap?: () => void;
  exportSave?: () => void;
  importSave?: () => void;
  recreateDatabase?: () => Promise<void>;
  replayCapturePending?: Promise<void>;
}

interface DevelopmentMilitaryControls {
  benchmarkTool: DevelopmentTool;
  /** Opens the economy AI "why" window (Economy tab). */
  economyAiTool: DevelopmentTool;
  militaryAiDebug: ExternalStore<MilitaryAiDebug | null>;
  militaryDebug: ExternalStore<MilitaryDebugControls | null>;
}

interface IslandDevelopmentToolOptions {
  /** Whether this account/build may see and run Development tools (owner decision 2026-10-15). */
  access: DevelopmentAccess;
  expeditionTheme: ExpeditionTheme;
  getSettlement: () => IslandSettlement | undefined;
  i18n?: I18n;
  saveStore: Pick<SaveStore, "readReplayReport">;
  sceneReplay?: SceneReplayRuntime;
  settlementEnabled: boolean;
  world: WorldData;
}

/** Settings > Development buttons; their actions reach the settlement once it is created. */
export const createIslandDevelopmentTools = (options: IslandDevelopmentToolOptions) => {
  const { access, getSettlement, i18n, saveStore, settlementEnabled, world } = options;
  const hooks: DevelopmentToolHooks = {};
  const exportSave = createIconTool("export", M.tool.exportGame, () => hooks.exportSave?.());
  const importSave = createIconTool("import", M.tool.importGame, () => hooks.importSave?.());
  exportSave.update({ disabled: true, title: M.title.unavailableExport });
  importSave.update({ disabled: true, title: M.title.unavailableImport });
  const openEditor = createIconTool("mapEditor", M.tool.openEditor,
    () => window.open(mapEditorUrl(location.href), "_blank", "noopener"));
  const openAdministration = createIconTool("scroll", M.tool.openAdministration,
    () => window.open(adminSettingsUrl(location.href), "_blank", "noopener"));
  const exportMap = createIconTool("map", M.tool.exportMap, () => hooks.exportMap?.());
  exportMap.update({ disabled: true, title: M.title.unavailableExport });
  const clearSaves = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/clear-saves.svg", import.meta.url).href,
    label: M.tool.clearSaves,
    title: M.title.clearSaves,
    onClick: () => {
      const settlement = getSettlement();
      clearSaves.update({ disabled: true });
      void hooks.clearSaves?.()
        .then(() => settlement?.message(translateMessage(i18n, M.toast.savesCleared)))
        .catch(error => settlement?.message(String(error), true))
        .finally(() => clearSaves.update({ disabled: false }));
    }
  });
  clearSaves.update({ disabled: true, title: M.title.unavailableDebug });
  const recreateDatabase = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/recreate-database.svg", import.meta.url).href,
    label: M.tool.recreateDatabase,
    title: M.title.recreateDatabase,
    onClick: () => {
      const settlement = getSettlement();
      recreateDatabase.update({ disabled: true });
      void hooks.recreateDatabase?.()
        .then(() => settlement?.message(translateMessage(i18n, M.toast.databaseRecreated)))
        .catch(error => settlement?.message(String(error), true))
        .finally(() => recreateDatabase.update({ disabled: false }));
    }
  });
  recreateDatabase.update({ disabled: true, title: M.title.unavailableDebug });
  const removeFog = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/remove-fog.svg", import.meta.url).href,
    label: M.tool.removeFog,
    title: M.title.removeFog,
    onClick: () => {
      const settlement = getSettlement();
      if (settlement) settlement.removeFog();
      else { world.fog.fill(FOG.visible); markFogChanged(world, true); }
    }
  });
  const discoveryDebug = createExpeditionDiscoveryDebug({ currentTheme: options.expeditionTheme,
    onCurrentTheme: theme => { void hooks.applyExpeditionTheme?.(theme); } });
  const militaryTest = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/dev-test-skirmish.png", import.meta.url).href,
    label: M.tool.testSkirmish,
    title: M.title.testSkirmish,
    onClick: () => {
      const settlement = getSettlement();
      const count = settlement?.simulation.startMilitaryTestSkirmish().length ?? 0;
      settlement?.message(count
        ? translateMessage(i18n, M.toast.testSkirmishSpawned, { count })
        : translateMessage(i18n, M.toast.deploySoldiers));
    }
  });
  const adventureTest = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/victory-emblem-roman.png", import.meta.url).href,
    label: M.tool.testAdventure,
    onClick: () => getSettlement()?.startDebugExpedition("adventure", discoveryDebug.override()),
    title: M.title.testAdventure
  });
  const colonyTest = createDevelopmentTool({
    icon: new URL("../../assets/building-icons/roman-39.png", import.meta.url).href,
    label: M.tool.testColony,
    onClick: () => getSettlement()?.startDebugExpedition("colony", discoveryDebug.override()),
    title: M.title.testColony
  });
  // Coins are bought in the gem shop now, so the development grant gives gems.
  const gemGrant = createDevelopmentTool({
    icon: progressionIcon("gem"),
    label: translateMessage(i18n, M.tool.grantGems, { count: DEVELOPMENT_GEM_GRANT }),
    onClick: () => getSettlement()?.grantGems(DEVELOPMENT_GEM_GRANT),
    title: M.title.grantGems
  });
  const levelGrant = createDevelopmentTool({
    icon: progressionIcon("level-star"),
    label: translateMessage(i18n, M.tool.playerLevel, { levels: 10 }),
    onClick: () => getSettlement()?.addDebugLevels(),
    title: M.title.playerLevel
  });
  const coinGrant = createDevelopmentTool({
    icon: new URL("../../assets/ware-icons/coins.png", import.meta.url).href,
    label: translateMessage(i18n, M.tool.addCoins, { count: DEVELOPMENT_COIN_GRANT }),
    onClick: () => getSettlement()?.grantCoins(DEVELOPMENT_COIN_GRANT),
    title: M.title.addCoins
  });
  const handcartGrant = createDevelopmentTool({
    icon: new URL("../../assets/ware-icons/handcart.png", import.meta.url).href,
    label: M.tool.handCart,
    onClick: () => getSettlement()?.grantHandcarts(1),
    title: M.title.handCart
  });
  const resetLogistics = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/reset-carriers-horses.png", import.meta.url).href,
    label: M.tool.resetCarriers,
    onClick: () => getSettlement()?.resetCarriers(),
    title: M.title.resetCarriers
  });
  const enemySpawn = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/army-roman-heavy.png", import.meta.url).href,
    iconClassName: "development-menu__enemy-icon",
    label: M.tool.spawnEnemy,
    onClick: () => {
      const settlement = getSettlement();
      settlement?.setEnemySpawnMode(!settlement.enemySpawnMode());
    },
    title: M.title.spawnEnemy
  });
  const shipSpawn = createDevelopmentTool({
    disabled: !settlementEnabled,
    icon: getSettlementIconSource("ship"),
    label: M.tool.createShip,
    sharedIcon: "ship",
    title: M.title.createShip,
    onClick: () => {
      const settlement = getSettlement();
      settlement?.setShipSpawnMode(!settlement.shipSpawnMode());
    }
  });
  shipSpawn.update({ active: false });
  const troopGrant = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/army-roman-shield.png", import.meta.url).href,
    label: M.tool.addUnit,
    onClick: () => getSettlement()?.grantDebugTroop(),
    title: M.title.addUnit
  });
  const buildingLevel = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/raise-building-level.svg", import.meta.url).href,
    label: M.tool.raiseBuilding,
    onClick: () => {
      const settlement = getSettlement();
      settlement?.setBuildingLevelMode(!settlement.buildingLevelMode());
    },
    title: M.title.raiseBuilding
  });
  const buildAll = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/roman-buildings.png", import.meta.url).href,
    label: M.tool.buildAll,
    onClick: () => getSettlement()?.buildEveryBuilding(),
    title: M.title.buildAll
  });
  const upgradeRoads = createDevelopmentTool({
    disabled: !settlementEnabled,
    icon: new URL("../../assets/road-previews/stone.png", import.meta.url).href,
    label: M.tool.upgradeRoads,
    sharedIcon: "roadUpgrade",
    onClick: () => getSettlement()?.upgradeOwnedRoads(),
    title: M.title.upgradeRoads
  });
  const npcTraders = createNpcTradersTool(() => getSettlement()?.simulation);
  const fillOutputs = createDevelopmentTool({
    icon: new URL("../../assets/ware-icons/planks.png", import.meta.url).href,
    label: M.tool.fillOutputs,
    onClick: () => getSettlement()?.fillAllOutputs(),
    title: M.title.fillOutputs
  });
  let reproductionState: "idle" | "recording" | "finished" = "idle";
  const saveReproduction = async () => {
    const settlement = getSettlement();
    if (!settlement) return false;
    try {
      await hooks.replayCapturePending;
      let report;
      try { report = settlement.bugReplay.report(); }
      catch {
        const previous = await saveStore.readReplayReport();
        if (!previous) throw new Error(translateMessage(i18n, M.toast.startRecordingFirst));
        report = JSON.parse(previous);
      }
      downloadJson(report, `settlers-reproduction-${report.baseline.map?.seed ?? world.seed}-${Date.now()}.json`);
      settlement.message(translateMessage(i18n, M.toast.reproductionExported));
      return true;
    } catch (error) {
      settlement.message(String(error), true);
      return false;
    }
  };
  const recordReproduction = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/record-reproduction.svg", import.meta.url).href,
    label: M.tool.recordReproduction,
    title: M.title.recordReproduction,
    onClick: () => {
      const settlement = getSettlement();
      if (!settlement || !hooks.captureReplayBaseline) return;
      if (reproductionState === "recording" || settlement.bugReplay.recording()) {
        void saveReproduction().then(saved => {
          reproductionState = saved ? "finished" : "recording";
          recordReproduction.update({ active: !saved });
          return saved;
        });
        return;
      }
      reproductionState = "recording";
      recordReproduction.update({ active: true });
      hooks.replayCapturePending = settlement.bugReplay.start(hooks.captureReplayBaseline)
        .then(() => getSettlement()?.message(translateMessage(i18n, M.toast.recordingReproduction)))
        .catch(error => {
          reproductionState = "idle";
          recordReproduction.update({ active: false });
          settlement.message(String(error), true);
        })
        .finally(() => { hooks.replayCapturePending = undefined; });
    }
  });
  const reportSceneError = (error: unknown) => getSettlement()?.message(String(error));
  const recordScene = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/record-scene.svg", import.meta.url).href,
    label: M.tool.recordScene,
    title: M.title.recordScene,
    onClick: () => { void options.sceneReplay?.start().catch(reportSceneError); }
  });
  const exportScene = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/stop-scene.svg", import.meta.url).href,
    label: M.tool.exportScene,
    title: M.title.exportScene,
    onClick: () => options.sceneReplay?.export()
  });
  const playScene = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/roman-merchant-ship.png", import.meta.url).href,
    label: M.tool.playScene,
    title: M.title.playScene,
    onClick: () => { void options.sceneReplay?.play(); }
  });
  const importSceneFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (file) void options.sceneReplay?.import(file).catch(reportSceneError);
  };
  const importScene = createDevelopmentTool({
    icon: new URL("../../assets/ui-icons/actions/import.webp", import.meta.url).href,
    label: M.tool.importScene,
    title: M.title.importScene,
    onClick: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => importSceneFile(input));
      input.click();
    }
  });
  /** Settings > Development groups; the military sections exist only with a settlement. */
  const debugGroups = (military: DevelopmentMilitaryControls): DevelopmentGroup[] => access.allowed ? [
    { id: "world", label: M.group.world, buttons: [openEditor, exportMap, removeFog, shipSpawn] },
    { id: "economy", label: M.group.economy, buttons: [gemGrant, coinGrant, levelGrant,
      handcartGrant, resetLogistics, buildAll, buildingLevel, fillOutputs, upgradeRoads, npcTraders.tool,
      military.economyAiTool] },
    { id: "military", label: M.group.military,
      buttons: [militaryTest, enemySpawn, troopGrant, adventureTest, colonyTest, military.benchmarkTool],
      sections: settlementEnabled ? [
        { debug: military.militaryDebug, kind: "military-debug" },
        { debug: military.militaryAiDebug, kind: "military-ai" },
        { debug: discoveryDebug, kind: "expedition-discovery" }
      ] : [] },
    { id: "diagnostics", label: M.group.diagnostics,
      buttons: [exportSave, importSave, recordReproduction, recordScene, exportScene, importScene,
        playScene, clearSaves, recreateDatabase, openAdministration] }
  ] : [];
  if (!access.allowed) {
    exportSave.update({ disabled: true, title: M.toast.developmentOnly });
    importSave.update({ disabled: true, title: M.toast.developmentOnly });
  }
  return { access, buildAll, buildingLevel, clearSaves, debugGroups, enemySpawn, exportMap, exportSave, hooks,
    importSave, npcTraders, recreateDatabase, sceneReplay: options.sceneReplay, shipSpawn };
};
