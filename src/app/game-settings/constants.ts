/** Boot value of the server's last public game settings (`{ revision, settings }` JSON), read when it is offline. */
export const CACHED_SETTINGS_KEY = "game-settings-last";
/** The public settings request shares the backend probe's patience: a slower answer falls back to the cache. */
export const SETTINGS_FETCH_TIMEOUT_MS = 2500;
/** The bundled build file under the public folder (shipped only when the owner picks settings for a build). */
export const BUNDLED_SETTINGS_FILE = "game-settings.json";
/** `?title=1` opens the title page (Exit game, the landing after a run without a home, tests; plan §7.2). */
export const TITLE_PARAM = "title";
/** `?continue=1` skips the title page once and continues the working slot (a Load in game, SAVE-SLOTS). */
export const CONTINUE_PARAM = "continue";
/** `?world=1` starts fresh from the shared authored World01 map (the map editor's Play), not the saved home island. */
export const WORLD_PLAY_PARAM = "world";
