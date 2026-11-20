import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { SCRIPT_MESSAGES as M } from "./messages";
import { TEMPLATE_LABEL_KEYS, type TemplateLabels } from "./template-parts";

/** The names a template gives its triggers, actors and regions, in the editor's language. */
export const templateLabels = (i18n: I18n | undefined, templateName: string): TemplateLabels =>
  Object.fromEntries(TEMPLATE_LABEL_KEYS.map(key => [key, key === "start"
    ? translateMessage(i18n, M.templates.startName, { name: templateName })
    : translateMessage(i18n, M.templates.labels[key])])) as TemplateLabels;
