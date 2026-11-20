import type { MessageDescriptor } from "@lingui/core";
import type { ContentText } from "@shared/catalog";

/** The Lingui descriptor of a content catalog text: its explicit message id and English source. */
export const contentDescriptor = (text: ContentText): MessageDescriptor => ({ id: text.key, message: text.en });
