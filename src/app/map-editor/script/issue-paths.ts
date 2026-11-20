import { ISSUE_CONTAINER_SEGMENTS, ISSUE_OWNER_LISTS } from "./constants";
import type { NodePath } from "./paths";
import { slotLabel } from "./sentences";

/**
 * Reading validation issue paths: which top-level item owns an issue and which slot word names its field. Shared by
 * the script editor's rows and the campaign Check panel (no validator in this module graph).
 */

/** The owner of an issue path and how many leading segments name it (a quest sits at `quests.quests[i]`). */
export const ownerOf = (path: NodePath): { depth: number; owner: string } => {
  const [list, index, nested] = path;
  const prefix = typeof list === "string" ? ISSUE_OWNER_LISTS[list] : undefined;
  if (prefix && typeof index === "number") return { depth: 2, owner: `${prefix}:${index}` };
  if (list === "quests" && index === "quests" && typeof nested === "number")
    return { depth: 3, owner: `quest:${nested}` };
  return { depth: 0, owner: "other" };
};

/** The slot the issue names, as a word ("killer"), for the message's `{path}` placeholder; "" for the node itself. */
export const issueSubject = (path: NodePath, locale: string) => {
  const name = [...path].reverse().find(key => typeof key === "string" && !ISSUE_CONTAINER_SEGMENTS.has(key));
  return typeof name === "string" ? slotLabel(name, locale) : "";
};
