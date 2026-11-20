import { scriptReferences, scriptUsersOf } from "../../../../../island-of-settlers-shared/src/script/references";
import type { ScriptRefKind } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import { translateMessage } from "../../../shared/i18n/translate";
import { type DescribeContext, describeRef } from "./describe";
import { SCRIPT_MESSAGES as M } from "./messages";

/**
 * "Used by" lists (design §13.4): the owners that reference a script item, named for the author ("trigger “Deer
 * hunt”, quest “The hunt”"). Deleting an item is refused while this list is not empty.
 */

const USER_WORDS = M.users;

type UserKind = keyof typeof USER_WORDS;

const isUserKind = (kind: string): kind is UserKind => Object.hasOwn(USER_WORDS, kind);

/** Owners (`trigger:<id>` …) of the references to an item, without the item itself. */
export const itemUsers = (script: MapScript, kinds: readonly ScriptRefKind[], id: string, self: string) => {
  const references = scriptReferences(script);
  return [...new Set(kinds.flatMap(kind => scriptUsersOf(references, kind, id)))]
    .filter(owner => owner !== self).sort();
};

/** The owners as the author reads them, joined with commas. */
export const describeUsers = (owners: readonly string[], context: DescribeContext) => owners.map(owner => {
  const separator = owner.indexOf(":");
  const kind = owner.slice(0, separator);
  const id = owner.slice(separator + 1);
  if (!isUserKind(kind)) return owner;
  return translateMessage(context.i18n, USER_WORDS[kind], { name: describeRef({ id, k: "ref", kind }, context) });
}).join(", ");
