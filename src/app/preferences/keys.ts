import { LANGUAGE_PREFERENCE_KEY } from "../../shared/i18n/locales";

/**
 * Every browser-storage preference key in one table (unification survey §10). The stored key strings are kept
 * exactly as they were, so existing players keep their choices; only new keys must use the
 * `island-of-settlers.` prefix with `.` separators. Dependency-free: the loading-screen head entry imports it.
 */
export type PreferenceScope = "local" | "session";

export interface PreferenceEntry {
  readonly key: string;
  readonly scope: PreferenceScope;
}

/** A key family: one stored value per id (`prefix + id`), e.g. per account or per settings section. */
export interface PreferenceFamilyEntry {
  readonly prefix: string;
  readonly scope: PreferenceScope;
}

const local = (key: string): PreferenceEntry => ({ key, scope: "local" });
const session = (key: string): PreferenceEntry => ({ key, scope: "session" });

export const PREFERENCES = {
  adaptivePerformance: local("island-of-settlers.graphics.adaptive"),
  /** The soldier-controls tip (military controls §11): shown once per profile, at the first selection. */
  armyControlsTip: local("island-of-settlers.army.controls-tip"),
  /** BR4: the campaign path facts of a run's stored end, shown once at home after the reload. */
  campaignEndNotice: session("island-of-settlers.campaign-end-notice"),
  characterDetail: local("island-of-settlers.graphics.character-detail"),
  cloudHandoff: session("island-settlers.cloud-handoff"),
  cloudSlot: session("island-settlers.cloud-slot"),
  coloniesCollapsed: session("island-of-settlers.colonies-collapsed"),
  critters: local("island-of-settlers.critters"),
  dayMode: local("island-of-settlers.day-mode"),
  detail: local("island-of-settlers.graphics.detail"),
  dialogueSpeed: local("island-of-settlers.dialogue-speed"),
  environmentVolume: local("island-of-settlers.sound.environment-volume"),
  fogOfWar: local("island-of-settlers.fog-of-war"),
  generatorIsland: local("island-of-settlers.island"),
  highlights: local("island-of-settlers.graphics.highlights"),
  hotkeyHints: local("island-of-settlers.possessed.hotkey-hints"),
  hotkeys: local("island-of-settlers.hotkeys"),
  hudPaperTheme: local("island-of-settlers.hud-paper-theme"),
  hudSurfaceStyle: local("island-of-settlers.hud-surface-style"),
  ignoreGlobalWinter: local("island-of-settlers.appearance.ignore-global-winter"),
  infoBox: local("island-of-settlers.info-box"),
  /** Read by the language store (shared/i18n/language-preference.ts), which reports whether it was saved. */
  language: local(LANGUAGE_PREFERENCE_KEY),
  loadingNation: local("island-of-settlers.loading-nation"),
  masterVolume: local("island-of-settlers.sound.master-volume"),
  minimap: local("island-of-settlers.minimap"),
  /** Settings "Mouse rotation": the mouse button whose drag turns the camera. */
  mouseRotation: local("island-of-settlers.camera.mouse-rotation"),
  /** The player's own multiboard header toggles, per map script and board. */
  multiboardCollapse: local("island-of-settlers.multiboards.collapsed"),
  musicVolume: local("island-of-settlers.sound.music-volume"),
  notifications: local("island-of-settlers.notifications"),
  npcTraders: local("island-of-settlers.npc-traders"),
  playerAvatarGender: local("island-of-settlers.player-avatar-gender"),
  portraitHidden: local("island-of-settlers.portrait-hidden"),
  probeFingerprint: local("island-of-settlers.graphics.probe"),
  qualityOverrides: local("island-of-settlers.graphics.overrides"),
  questIllustrations: local("island-of-settlers.quest-illustrations"),
  recommendedDetail: local("island-of-settlers.graphics.recommended"),
  resolution: local("island-of-settlers.graphics.resolution"),
  revealOre: local("island-of-settlers.reveal-ore"),
  sound: local("island-of-settlers.sound"),
  soundLayersOff: local("island-of-settlers.sound.layers-off"),
  /** Settings > Misc "System cursor": the operating system's pointer instead of the game cursor set. */
  systemCursor: local("island-of-settlers.system-cursor"),
  tone: local("island-of-settlers.graphics.tone"),
  workerColor: local("island-of-settlers.worker-color"),
  workerNation: local("island-of-settlers.worker-nation")
} as const satisfies Record<string, PreferenceEntry>;

export const PREFERENCE_FAMILIES = {
  /** Pending server inventory/road-decoration/commander requests of a tab (idempotency keys). */
  inventoryRequest: { prefix: "island-of-settlers.inventory-request:", scope: "session" },
  /** Pending Player Market operations of a tab, per account and slot. */
  marketOperation: { prefix: "island-settlers.market.", scope: "session" },
  /** Signed-in accounts' avatar gender (`<guest key>.<account id>`). */
  playerAvatarGender: { prefix: "island-of-settlers.player-avatar-gender.", scope: "local" },
  /** Open state of one collapsible settings section. */
  settingsSection: { prefix: "island-of-settlers.settings.section.", scope: "local" }
} as const satisfies Record<string, PreferenceFamilyEntry>;

/** Every fixed key (bench helpers seed or clear them; tests check uniqueness). */
export const PREFERENCE_KEY_LIST: readonly string[] = Object.values(PREFERENCES).map(entry => entry.key);
