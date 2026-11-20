/** Work that must finish before the page reloads (the scene recording carries on after it). */
let beforeReload: (() => Promise<void>) | undefined;

export const setBeforePageReload = (hook: (() => Promise<void>) | undefined) => {
  beforeReload = hook;
};

/** Session value (per tab, survives the reload): the next boot is a reload of the running game. */
const IN_SESSION_RELOAD_KEY = "island-in-session-reload";

const rememberInSessionReload = () => {
  try {
    sessionStorage.setItem(IN_SESSION_RELOAD_KEY, "1");
  } catch {
    // No session storage: the title page shows again where one exists, and Continue resumes the game.
  }
};

/**
 * True once after `reloadPage`: the boot continues the running game without the title page (a voyage, a new
 * island or a detail level is not a new visit). Never thrown.
 */
export const takeInSessionReload = () => {
  try {
    const marked = sessionStorage.getItem(IN_SESSION_RELOAD_KEY) !== null;
    sessionStorage.removeItem(IN_SESSION_RELOAD_KEY);
    return marked;
  } catch {
    return false;
  }
};

/**
 * Every island change reloads the page (another map, a new island, a loaded game, a voyage, a
 * detail level): the registered work runs first; without any the navigation stays synchronous.
 * The next boot learns it is such a reload (`takeInSessionReload`).
 */
export const reloadPage = (href?: string) => {
  const navigate = () => {
    rememberInSessionReload();
    if (href === undefined) location.reload();
    else location.href = href;
  };
  if (!beforeReload) {
    navigate();
    return;
  }
  void beforeReload().catch(() => undefined).finally(navigate);
};
