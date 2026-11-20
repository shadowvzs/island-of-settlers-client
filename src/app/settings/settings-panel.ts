import type { I18n } from "@lingui/core";

import type { SettingsSection } from "../../../../island-of-settlers-shared/src/script/types/ui";
import type { CameraState } from "../../render-common/camera-state";
import type { CharacterDetailChoice } from "../../render-common/character-detail";
import type { ColorTone } from "../../render-common/color-output";
import type { QualityLevel } from "../../render-common/quality";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import type { ResolutionMode } from "../../render-common/resolution";
import type { WorkerColor } from "../../render-common/workers/worker-colors";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { AccountSettingsOptions } from "../account/settings/helpers";
import type { SoundControls } from "../audio/sound-controls";
import { createLazyReactContent } from "../components/lazy-react-content";
import type { MapPanelContent } from "../map-generator/panel";
import type { ObservationPickKind } from "../observation/helpers";
import type { RenderBudgetControls } from "../render-budget/render-budget";
import type { WeatherControls } from "../weather-controls";
import type { CameraBookmarkControls } from "./camera/bookmark-controls";
import { createCameraPanelContent } from "./camera/camera-panel";
import { SETTINGS_CHROME_MESSAGES as CHROME } from "./chrome-messages";
import { type CornerPanel, createCornerPanels } from "./corner-panel";
import { createDevelopmentTabs } from "./development/development-tabs";
import { type DevelopmentGroup, type DevelopmentTool, globalAppearanceSections } from "./development/helpers";
import { DEVELOPMENT_MESSAGES as D } from "./development/messages";
import { type ApplyDetail, reloadWithDetail, reloadWithRevealOre } from "./graphics-settings";
import { SETTINGS_MESSAGES } from "./sections/messages";
import { createSettingsSectionRequest, type SettingsSectionRequest } from "./sections/section-request";
import type { SettingsSectionsProps } from "./sections/settings-sections";

export interface SettingsPanelOptions {
  /** Active translator for DOM-created labels and helper-owned captions. */
  i18n?: I18n;
  /** Signed-in player (Settings > Account: log out, password, export, delete); absent for guests. */
  account?: AccountSettingsOptions;
  /** Named groups of development actions and controls. */
  debugGroups?: readonly DevelopmentGroup[];
  /** Owner 2026-10-15: the Development tools corner is shown only to administrators or a dev-build guest. */
  development?: boolean;
  /** The server-verified administrator may change the globally shared cosmetic season. */
  seasonalAdmin?: boolean;
  /** Applies a pending Character detail choice live (renderer cap and cadence floor; stores it). */
  applyCharacterDetail: (choice: CharacterDetailChoice) => void;
  /** Applies Detail without a page reload; absent keeps the reload path. */
  applyDetail?: ApplyDetail;
  /** Character detail choice; "auto" follows the Detail level. */
  characterDetail: CharacterDetailChoice;
  /** Detail setting (quality level). */
  detail: QualityLevel;
  /**
   * Decorative life shown: birds, butterflies and critters (visual only; animals that are
   * hunted or fished always show).
   */
  critters: boolean;
  /** Reversible presentation only; explored map data continues to update. */
  fog: boolean;
  /** True while the game's rules switch fog of war off: the display option is locked off (GS4a). */
  fogLocked?: () => boolean;
  /** Settings > Misc > Game: Exit game where a title page exists (GS3b); absent elsewhere. */
  game?: SettingsSectionsProps["game"];
  setFog: (visible: boolean) => void;
  /** Development tools > Diagnostics tool of the info panel (frame statistics and controls help). */
  infoTool: DevelopmentTool;
  /** Map generator panel content (current island, new island form), mounted on first open. */
  map: MapPanelContent;
  /** Detected on the first run (marked "recommended" on the slider); null when unknown. */
  recommended: QualityLevel | null;
  /** Every mine field shows its ore (as if surveyed). */
  revealOre: boolean;
  /** Applies Reveal Ore without a page reload; absent keeps the reload path. */
  setRevealOre?: (revealed: boolean) => void;
  renderer: TerrainRenderer;
  /** Resolution setting (pixel ratio cap, MSAA). */
  resolution: ResolutionMode;
  /** Applies a Resolution choice: live unless its resolved antialias setting differs. */
  applyResolution: (mode: ResolutionMode) => void;
  /** Adaptive performance (R09/C13 budget controller); absent where no island renders. */
  budget?: RenderBudgetControls;
  /** Highlights / glare strength 0..1, applied live. */
  highlights: number;
  /** Tone setting (Auto / Vivid / Filmic), applied live. */
  tone: ColorTone;
  setHighlights: (strength: number) => void;
  setTone: (tone: ColorTone) => void;
  /** Back to the default angle: no rotation, iso view. */
  resetCamera: () => void;
  setCritters: (enabled: boolean) => void;
  /** Sound settings (on / off, volumes, layers), adapted by the audio module. */
  sound: SoundControls;
  toggleCinematic: () => void;
  weather: WeatherControls;
  workerColor: WorkerColor;
  workerNation: WorkerNation;
  setWorkerColor: (color: WorkerColor) => void;
  setWorkerNation: (nation: WorkerNation) => Promise<void>;
  /** Verified Development access only; separate from paid player customization. */
  setDebugWorkerNation?: (nation: WorkerNation) => Promise<void>;
  camera: CameraState;
  cameraMapSize: readonly [number, number];
  /** Camera panel Watch worker / ship: opens the Observe window in picking mode. */
  observation?: { startPicking: (kind: ObservationPickKind) => void };
  /** Camera panel bookmarks of the island (saved with the game). */
  bookmarks?: CameraBookmarkControls;
}

/** Watch worker / ship: start picking, then close the camera panel (the order of the former DOM launchers). */
const createWatch = (options: SettingsPanelOptions, closePanel: () => void) => {
  const { observation } = options;
  if (!observation) return undefined;
  return (kind: ObservationPickKind) => {
    observation.startPicking(kind);
    closePanel();
  };
};

/** Camera panel content (React on first open); Watch worker / ship close the panel. */
const createCameraContent = (options: SettingsPanelOptions, getPanel: () => CornerPanel) =>
  createCameraPanelContent({
    bookmarks: options.bookmarks,
    i18n: options.i18n,
    camera: options.camera,
    isShown: () => getPanel().isOpen(),
    mapSize: options.cameraMapSize,
    renderer: options.renderer,
    resetCamera: options.resetCamera,
    toggleCinematic: options.toggleCinematic,
    watch: createWatch(options, () => getPanel().setOpen(false))
  });

/** A development tool whose click also closes the Development tools panel (as the former DOM openers did). */
const closingDevelopment = (tool: DevelopmentTool, getDevelopment: () => CornerPanel | undefined): DevelopmentTool => ({
  ...tool,
  onClick: () => {
    tool.onClick();
    getDevelopment()?.setOpen(false);
  }
});

/**
 * Values and DOM parts of the Settings sections. The window launchers are created at startup as before
 * (their windows join the layer at once); React renders the rest.
 */
const MAP_GENERATOR_LABEL = D.tool.mapGenerator;

const createSettingsSectionsProps = (
  container: HTMLElement,
  options: SettingsPanelOptions,
  sectionRequest: SettingsSectionRequest
): SettingsSectionsProps => ({
  account: options.account,
  applyCharacterDetail: options.applyCharacterDetail,
  applyDetail: options.applyDetail ?? reloadWithDetail,
  applyResolution: options.applyResolution,
  budget: options.budget,
  characterDetail: options.characterDetail,
  critters: options.critters,
  detail: options.detail,
  fog: options.fog,
  fogLocked: options.fogLocked,
  game: options.game,
  highlights: options.highlights,
  recommended: options.recommended,
  resolution: options.resolution,
  sectionRequest: sectionRequest.store,
  sound: options.sound,
  tone: options.tone,
  weather: options.weather,
  setCritters: options.setCritters,
  setFog: options.setFog,
  setHighlights: options.setHighlights,
  setTone: options.setTone
});

/**
 * Top-right settings, development and camera panels (icon row buttons) and the map generator panel (opened
 * from Development tools > World). Camera buttons stay together; gameplay settings remain separate from
 * development tools.
 */
export const createSettingsPanel = (container: HTMLElement, options: SettingsPanelOptions) => {
  const settingsContent = document.createElement("div");
  settingsContent.className = "settings-panel__content";
  const sections = createLazyReactContent(settingsContent, "Settings", async () =>
    (await import("./sections/mount-settings-sections")).createSettingsSectionsMount(sectionsProps));
  const cameraContent = createCameraContent(options, () => cameraPanel);
  const developmentTabs = createDevelopmentTabs([
    // The editor/generator are separate pages now; World keeps only its development controls.
    { id: "world", label: D.group.world, sections: [
      { checked: options.revealOre, kind: "reveal-ore", onChange: options.setRevealOre ?? reloadWithRevealOre },
      { kind: "weather", weather: options.weather }
    ] },
    ...options.debugGroups ?? [],
    { id: "appearance", label: D.group.appearance, sections: [...globalAppearanceSections(options.seasonalAdmin), {
      color: options.workerColor, kind: "workers", onColorChange: options.setWorkerColor,
      onNationChange: options.setDebugWorkerNation ?? (async () => { throw new Error("Development access is required"); })
    }] },
    { id: "diagnostics", label: D.group.diagnostics, buttons: [closingDevelopment(options.infoTool, () => development)] }
  ], options.i18n);
  const showDevelopment = options.development !== false;
  const developmentSpec = {
    className: "development-menu", content: developmentTabs.content, icon: { kind: "settlement" as const,
      name: "development" as const },
    id: "development", label: D.panel.title,
    onOpen: () => developmentTabs.mount()
  };
  const corner = createCornerPanels(container, [
    { content: options.map.content, id: "map", label: MAP_GENERATOR_LABEL, onOpen: options.map.mount },
    {
      className: "settings-menu", content: settingsContent, icon: { kind: "settlement", name: "settings" },
      id: "settings", label: SETTINGS_MESSAGES.panelTitle, onOpen: () => sections.mount()
    },
    ...showDevelopment ? [developmentSpec] : [],
    {
      className: "camera-controls-panel", content: cameraContent.content, icon: { kind: "camera", name: "camera" },
      id: "camera", label: CHROME.camera.controls, onOpen: () => cameraContent.open()
    }
  ]);
  const [map, settings] = corner.panels as [CornerPanel, CornerPanel, ...CornerPanel[]];
  const development = showDevelopment ? corner.panels[2] : undefined;
  const cameraPanel = corner.panels[showDevelopment ? 3 : 2]!;
  const sectionRequest = createSettingsSectionRequest();
  const sectionsProps = createSettingsSectionsProps(container, options, sectionRequest);
  return {
    /** Closes every settings/development/map/camera corner panel. */
    closeAllWindows: () => corner.closeAll(),
    /** Standalone editor: opens (or closes) the map-generator panel directly. */
    isMapOpen: () => map.isOpen(),
    openMap: () => map.toggle(),
    /** The corner icon row (the theme toggle joins it). */
    cornerRow: corner.row,
    /** Releases corner panels, lazy React roots, camera/zoom listeners and the map panel. */
    dispose: () => {
      corner.dispose();
      sections.dispose();
      cameraContent.dispose();
      developmentTabs.dispose();
      options.map.dispose();
    },
    /** A corner menu is open: an idle moment for saving (D3). */
    isMenuOpen: corner.isAnyOpen,
    /** With a settlement the HUD Menu opens Settings, so its corner button is hidden. */
    hideSettingsButton: () => corner.row.update("settings", { hidden: true }),
    /** Island shown: the corner's React row and panels load on the next idle moment. */
    onIslandShown: corner.onIslandShown,
    refresh: cameraContent.refresh,
    setWorkerNation: options.setWorkerNation,
    toggle: () => settings.setOpen(!settings.isOpen()),
    /** Script `openUi settings` (TRG9): opens (never toggles) on the section's tab; `closeUi` hides it. */
    openSection: (section?: SettingsSection) => {
      if (section) sectionRequest.request(section);
      settings.setOpen(true);
    },
    closeSettings: () => settings.setOpen(false)
  };
};
