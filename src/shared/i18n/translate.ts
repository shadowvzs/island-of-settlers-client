import type { I18n, MessageDescriptor, Values } from "@lingui/core";

import { formatSourceMessage } from "../../../../island-of-settlers-shared/src/script/text/format";

/**
 * Resolve a message descriptor through the active Lingui instance. Helpers that also run in tests
 * without an I18n instance fall back to the source text of the descriptor.
 */
export const translateMessage = (
  i18n: I18n | undefined,
  descriptor: MessageDescriptor,
  values?: Values
) => {
  if (i18n) return i18n._(values ? { ...descriptor, values } : descriptor);
  const source = descriptor.message ?? descriptor.id;
  // The shared source fallback also resolves simple one/other ICU plurals (with `#`), so helpers remain
  // readable before a locale provider is installed.
  return values ? formatSourceMessage(source, values) : source;
};

/** A label that may already be literal text or a lazily translated Lingui descriptor. */
export const translateLabel = (i18n: I18n | undefined, label: string | MessageDescriptor) =>
  typeof label === "string" ? label : translateMessage(i18n, label);
