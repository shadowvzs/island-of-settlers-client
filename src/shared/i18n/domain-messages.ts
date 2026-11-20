import type { MessageDescriptor } from "@lingui/core";

import { DOMAIN_APP_MESSAGES } from "./domain-app-messages";
import { DOMAIN_NAME_MESSAGES } from "./domain-names-messages";
import { DOMAIN_REFUSAL_MESSAGES } from "./domain-refusal-messages";
import { DOMAIN_STATUS_MESSAGES, DOMAIN_STATUS_PATTERNS } from "./domain-status-messages";
import { QUEST_CATALOG_MESSAGES } from "./quest-catalog-messages";

/**
 * The one canonical message map for game-domain vocabulary and simulation output. Explicit
 * `domain.*` ids are stable; keys are save ids, English source sentences or semantic group names.
 * Views resolve these descriptors through the active Lingui locale and never keep a translated
 * copy in simulation state.
 */
export const DOMAIN_MESSAGES = {
  app: DOMAIN_APP_MESSAGES,
  names: DOMAIN_NAME_MESSAGES,
  refusal: DOMAIN_REFUSAL_MESSAGES,
  status: { ...DOMAIN_STATUS_MESSAGES, patterns: DOMAIN_STATUS_PATTERNS },
  tutorial: QUEST_CATALOG_MESSAGES
} as const;

export type DomainMessageSource = typeof DOMAIN_MESSAGES;

/** Every descriptor in the canonical map, for tests and the translation-draft generator. */
export const collectDomainMessages = () => {
  const messages: MessageDescriptor[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if ("id" in value && typeof value.id === "string" &&
      (!("message" in value) || typeof value.message === "string")) {
      messages.push(value as MessageDescriptor);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(DOMAIN_MESSAGES);
  return messages;
};
