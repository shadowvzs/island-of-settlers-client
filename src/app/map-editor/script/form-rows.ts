import type { BlockPart } from "./block-parts";
import type { EventRow, ScriptRow, SentenceBlock } from "./blocks";
import { isPathPrefix, type NodePath, pathKey } from "./paths";
import { rowIssues, type ShownIssue, slotHasError } from "./validation";

/**
 * Sentence rows with their live validation (design §13.2: red underline + message per row): every slot knows
 * whether an error names it, and each row lists the messages of its own node (not of nested rows). A deep link's
 * field path (`linked`) marks the row and slot it names the same way.
 */

export type ShownPart =
  | { kind: "text"; key: string; text: string }
  | { children: ShownPart[] | null; error: boolean; key: string; kind: "slot"; label: string; linked: boolean;
    optional: boolean; part: Extract<BlockPart, { kind: "slot" }>; summary: string };

export interface ShownBlock {
  comment: string;
  disabled: boolean;
  /** An error names this row's node (red underline). */
  hasError: boolean;
  issues: readonly ShownIssue[];
  key: string;
  /** The deep link's field path names this row's node (highlight, scrolled into view). */
  linked: boolean;
  parts: ShownPart[];
  path: NodePath;
}

/** A deep link's field path inside the shown item; null when no link names a field. */
export type LinkedPath = NodePath | null;

const showParts = (
  parts: readonly BlockPart[], issues: readonly ShownIssue[], prefix: string, linked: LinkedPath
): ShownPart[] =>
  parts.map((part, index) => {
    if (part.kind === "text") return { kind: "text", key: `${prefix}t${index}`, text: part.text };
    return { children: part.children ? showParts(part.children, issues, part.key, linked) : null,
      error: slotHasError(issues, part.path), key: part.key, kind: "slot", label: part.label,
      linked: linked !== null && isPathPrefix(part.path, linked), optional: part.optional, part,
      summary: part.summary };
  });

/** Paths of nested rows below a node: their issues are listed on those rows instead. */
const CHILD_FIELDS = ["then", "else", "body", "cond", "of"] as const;
const childPaths = (path: NodePath) => CHILD_FIELDS.map(field => [...path, field]);

/** True when the linked field lies in this row's node, not inside a nested row below it. */
const isLinkedRow = (path: NodePath, linked: LinkedPath) => linked !== null && isPathPrefix(path, linked) &&
  !childPaths(path).some(child => isPathPrefix(child, linked));

export const showBlock = (
  block: SentenceBlock, issues: readonly ShownIssue[], linked: LinkedPath = null
): ShownBlock => {
  const own = rowIssues(issues, block.path, childPaths(block.path));
  return {
    comment: block.comment ?? "",
    disabled: block.disabled,
    hasError: own.some(issue => issue.severity === "error"),
    issues: own,
    key: block.key,
    linked: isLinkedRow(block.path, linked),
    parts: showParts(block.parts, issues, block.key, linked),
    path: block.path
  };
};

export type ShownEventRow = ShownBlock & Pick<EventRow, "canInvert" | "phrasing">;

export const showEventRow = (
  row: EventRow, issues: readonly ShownIssue[], linked: LinkedPath = null
): ShownEventRow =>
  ({ ...showBlock(row, issues, linked), canInvert: row.canInvert, phrasing: row.phrasing });

/** A row with its block shown (distributes over the row kinds). */
type WithShownBlock<R> = R extends { block: SentenceBlock } ? Omit<R, "block"> & { block: ShownBlock } : R;
export type ShownRow = WithShownBlock<ScriptRow>;

export const showRows = (
  rows: readonly ScriptRow[], issues: readonly ShownIssue[], linked: LinkedPath = null
): ShownRow[] => rows.map(row => {
  if (row.kind !== "condition" && row.kind !== "step") return row;
  return { ...row, block: showBlock(row.block, issues, linked) } as ShownRow;
});

/** Issues of a list itself (e.g. "the action list is too long"), shown under its section. */
export const listIssues = (issues: readonly ShownIssue[], listPath: NodePath) =>
  issues.filter(issue => pathKey(issue.path) === pathKey(listPath) || (issue.path.length === listPath.length + 1 &&
    pathKey(issue.path.slice(0, -1)) === pathKey(listPath) && typeof issue.path.at(-1) === "string"));

/** A stable React key of a row. */
export const shownRowKey = (row: ShownRow) => (row.kind === "condition" || row.kind === "step" ? row.block.key
  : row.key);
