import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { ADVENTURE_THEMES, type AdventureTheme } from "../../shared/settlement/adventure-themes";
import type { DiscoveryOverride } from "../../shared/settlement/island-discovery-policy";
import type { SelectOption } from "../components/helpers";
import { DEVELOPMENT_MESSAGES as M } from "./development/messages";

/** Month select: the real calendar or a month number ("1".."12"), resolved in the active locale. */
export const getMonthChoices = (i18n?: I18n): readonly SelectOption<string>[] => [
  { label: translateMessage(i18n, M.month.realCalendar), value: "" },
  ...(["january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december"] as const).map((month, index) => ({
    label: translateMessage(i18n, M.month[month]), value: String(index + 1)
  }))
];

export const MONTH_CHOICES = getMonthChoices();

/** Island theme select: the seasonal selection or one theme, resolved in the active locale. */
export const getThemeChoices = (i18n?: I18n): readonly SelectOption<AdventureTheme | "">[] => [
  { label: translateMessage(i18n, M.theme.seasonal), value: "" },
  ...ADVENTURE_THEMES.map(value => ({ label: translateMessage(i18n, M.theme[value]), value }))
];

export const THEME_CHOICES = getThemeChoices();

/** The debug discovery override of the chosen month / theme; undefined when both follow the defaults. */
export const getDiscoveryOverride = (month: string, theme: AdventureTheme | ""): DiscoveryOverride | undefined => {
  if (!month && !theme) return undefined;
  return { ...(month ? { month: Number(month) } : {}), ...(theme ? { theme } : {}) };
};

/** Debug discoveries use these overrides; an explicit theme can also restyle the visited expedition. */
export const createExpeditionDiscoveryDebug = (options: {
  currentTheme?: AdventureTheme; onCurrentTheme?: (theme: AdventureTheme) => void
} = {}) => {
  let month = "";
  let theme: AdventureTheme | "" = options.currentTheme ?? "";
  return {
    month: () => month,
    override: () => getDiscoveryOverride(month, theme),
    setMonth: (value: string) => { month = value; },
    setTheme: (value: AdventureTheme | "") => {
      theme = value;
      if (value) options.onCurrentTheme?.(value);
    },
    theme: () => theme
  };
};

export type ExpeditionDiscoveryDebug = ReturnType<typeof createExpeditionDiscoveryDebug>;
