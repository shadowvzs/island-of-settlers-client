import { type AppLocale, LANGUAGE_OPTIONS } from "../shared/i18n/locales";
import "./cursors/cursor-preference";
import { readLoadingNation, setLoadingNation } from "./loading-illustrations";
import { LOADING_MESSAGES } from "./loading-messages";
import { languagePreference } from "./localization/language-store";

const LANGUAGE_LABEL = { id: "settings.window.language", message: "Language" };

const FLAG_MARKUP: Record<AppLocale, string> = {
  de: '<svg aria-hidden="true" class="loading-screen__language-flag" focusable="false" viewBox="0 0 60 36">'
    + '<rect fill="#ffce00" height="36" width="60"/><rect fill="#000000" height="12" width="60"/>'
    + '<rect fill="#dd0000" height="12" width="60" y="12"/></svg>',
  en: '<svg aria-hidden="true" class="loading-screen__language-flag" focusable="false" viewBox="0 0 60 36">'
    + '<rect fill="#012169" height="36" width="60"/><path d="M0 0 60 36M60 0 0 36" stroke="#ffffff" '
    + 'stroke-width="8"/><path d="M0 0 60 36M60 0 0 36" stroke="#c8102e" stroke-width="4"/>'
    + '<path d="M30 0v36M0 18h60" stroke="#ffffff" stroke-width="14"/>'
    + '<path d="M30 0v36M0 18h60" stroke="#c8102e" stroke-width="8"/></svg>',
  hu: '<svg aria-hidden="true" class="loading-screen__language-flag" focusable="false" viewBox="0 0 60 36">'
    + '<rect fill="#ffffff" height="36" width="60"/><rect fill="#ce2939" height="12" width="60"/>'
    + '<rect fill="#477050" height="12" width="60" y="24"/></svg>'
};

/** The first screen also offers the language before any account or island work begins. */
const mountLanguageChoice = (root: HTMLElement) => {
  const panel = root.querySelector<HTMLElement>(".loading-screen__panel");
  if (!panel || panel.querySelector(".loading-screen__language")) return;
  const group = document.createElement("div");
  group.className = "loading-screen__language";
  group.setAttribute("role", "radiogroup");
  const buttons = new Map<string, HTMLButtonElement>();
  const sync = () => {
    group.setAttribute("aria-label", languagePreference.i18n._(LANGUAGE_LABEL));
    for (const [locale, button] of buttons)
      button.setAttribute("aria-checked", String(languagePreference.getSnapshot().locale === locale));
  };
  for (const option of LANGUAGE_OPTIONS) {
    const button = document.createElement("button");
    button.className = "loading-screen__language-button";
    button.type = "button";
    button.setAttribute("role", "radio");
    button.innerHTML = `${FLAG_MARKUP[option.locale]}<span>${option.label}</span>`;
    button.addEventListener("click", () => { languagePreference.setLanguage(option.locale); });
    buttons.set(option.locale, button);
    group.append(button);
  }
  sync();
  // The choice is the state at once; its lazily loaded catalog relabels the group when active.
  languagePreference.subscribe(sync);
  languagePreference.i18n.on("change", sync);
  panel.prepend(group);
};

// Vite bundles this head script into the player entry chunk together with main.ts. That entry stays small
// because main.ts loads the boot session and the game graph dynamically, so the remembered nation's artwork
// and the language choice paint before the large game graph has downloaded.
const root = document.getElementById("loading-screen");
if (root) {
  setLoadingNation(root, readLoadingNation());
  const message = root.querySelector<HTMLElement>(".loading-screen__message");
  if (message) {
    const paintMessage = () => { message.textContent = languagePreference.i18n._(LOADING_MESSAGES.preparing); };
    paintMessage();
    void languagePreference.ready().then(paintMessage);
  }
  mountLanguageChoice(root);
}
