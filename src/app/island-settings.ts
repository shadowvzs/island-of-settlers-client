import { randomWorkerAppearances } from "../render-common/workers/worker-appearance";
import { getWorkerColorHex } from "../render-common/workers/worker-colors";
import type { createWorkerGroup } from "../render-common/workers/worker-group";
import { setFogDisplay } from "../shared/world/fog-display";
import type { WorldData } from "../shared/world/world-data";
import { createHudThemeToggle } from "./hud-theme";
import type { createLoadingScreen } from "./loading-screen";
import { setPlayerAvatarNation } from "./player-avatar/store";
import { applyDebugNationChange, applyPaidNationChange } from "./settings/customization/nation-change";
import { settingsStorage } from "./settings/graphics-settings";
import { createSettingsPanel, type SettingsPanelOptions } from "./settings/settings-panel";
import type { IslandSettlement } from "./settlement/island-settlement";
import { setShipIconNation } from "./settlement-ui/icons";

type SettingsPanelValues = Pick<SettingsPanelOptions, "account" | "i18n" | "applyDetail" | "applyResolution" | "bookmarks" | "budget" | "camera" | "critters" |
  "debugGroups" | "detail" | "development" | "fog" | "game" | "infoTool" | "map" | "observation" | "recommended" | "renderer" |
  "resolution" | "revealOre" | "seasonalAdmin" | "setCritters" | "setRevealOre" | "sound" | "toggleCinematic" | "weather" | "workerColor" | "workerNation">;

interface IslandSettingsOptions extends SettingsPanelValues {
  getSettlement: () => IslandSettlement | undefined;
  loading: Pick<ReturnType<typeof createLoadingScreen>, "setNation">;
  minimap: { refresh: () => void };
  workers: ReturnType<typeof createWorkerGroup>;
  world: WorldData;
}

/** The settings panel (and the HUD theme toggle in its corner row) wired to the island's services. */
export const createIslandSettings = (viewport: HTMLElement, options: IslandSettingsOptions) => {
  const { camera, getSettlement, loading, minimap, renderer, workers, world, ...values } = options;
  let nationChangeBusy = false;
  let disposed = false;
  const changeNation = async (kind: "debug" | "player", nation: Parameters<SettingsPanelOptions["setWorkerNation"]>[0]) => {
    const settlement = getSettlement();
    const current = settlement?.simulation.playerNation() ?? values.workerNation;
    if (kind === "debug" && values.development !== true) throw new Error("Development access is required");
    if (nation === current) return;
    if (nationChangeBusy) throw new Error("A nation change is already in progress");
    if (!settlement || !renderer.prepareWorkerAppearances) throw new Error("Nation changes are unavailable");
    nationChangeBusy = true;
    const appearances = randomWorkerAppearances(workers.frames.length, nation);
    const common = {
      current, next: nation,
      validate: () => !disposed && getSettlement() === settlement && settlement.simulation.canSetPlayerNation(nation),
      prepare: () => renderer.prepareWorkerAppearances!(appearances),
      apply: () => {
        let changed = false;
        if (kind === "debug") changed = settlement.simulation.debugSetPlayerNation(nation);
        else changed = settlement.simulation.setPlayerNation(nation);
        if (!changed) throw new Error("Nation replacement failed");
        workers.frames.forEach((frame, index) => Object.assign(frame, appearances[index]));
        settlement.setPlayerAppearances(appearances);
        setPlayerAvatarNation(nation);
        setShipIconNation(nation);
        settingsStorage.writeWorkerNation(nation);
        loading.setNation(nation);
      }
    };
    try {
      if (kind === "debug") await applyDebugNationChange({ ...common, allowed: values.development === true });
      else {
        const player = settlement.playerSession;
        if (!player) throw new Error("Nation changes are unavailable");
        await applyPaidNationChange({ ...common, hasItem: player.hasNationItem,
          consume: () => player.changeNation(current, nation) });
      }
    } finally { nationChangeBusy = false; }
  };
  const settings = createSettingsPanel(viewport, {
    ...values,
    applyCharacterDetail: choice => {
      settingsStorage.writeCharacterDetail(choice);
      renderer.setCharacterDetail?.(choice);
    },
    camera,
    cameraMapSize: [world.cellsX, world.cellsZ],
    characterDetail: settingsStorage.readCharacterDetail(),
    setWorkerColor: (color) => {
      renderer.setWorkerColor(getWorkerColorHex(color));
      settingsStorage.writeWorkerColor(color);
    },
    setWorkerNation: nation => changeNation("player", nation),
    setDebugWorkerNation: nation => changeNation("debug", nation),
    setHighlights: strength => {
      renderer.setHighlights(strength);
      settingsStorage.writeHighlights(strength);
    },
    setTone: tone => {
      renderer.setColorTone(tone);
      settingsStorage.writeTone(tone);
    },
    fogLocked: () => getSettlement()?.simulation.effectiveGameRules().fogOfWar === false,
    setFog: visible => {
      settingsStorage.writeFog(visible);
      setFogDisplay(world, visible);
      const query = new URLSearchParams(location.search);
      query.delete("reveal");
      history.replaceState(history.state, "", `${location.pathname}${query.size ? `?${query}` : ""}${location.hash}`);
      minimap.refresh();
    },
    renderer,
    highlights: settingsStorage.readHighlights(),
    tone: settingsStorage.readTone(),
    resetCamera: () => {
      camera.tilt = 0;
      camera.yaw = 0;
      renderer.setViewMode("iso");
    }
  });
  const theme = createHudThemeToggle(viewport, settings.cornerRow, options.i18n);
  return {
    ...settings,
    dispose: () => {
      disposed = true;
      theme.dispose();
      settings.dispose();
    }
  };
};
