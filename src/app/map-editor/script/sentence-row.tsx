import type { KeyboardEvent, ReactNode } from "react";

import type { SlotPart } from "./block-parts";
import { scrollIntoViewWhen } from "./focus";
import type { ShownBlock, ShownPart } from "./form-rows";
import type { NodePath } from "./paths";
import type { StepCommands } from "./step-commands";
import type { FormLabels } from "./use-form-labels";
import type { ShownIssue } from "./validation";

interface SentencePartsProps {
  labels: FormLabels;
  parts: readonly ShownPart[];
  onOpenSlot: (part: SlotPart) => void;
}
/** A sentence: text and typed slot buttons; a function or math value nests its own sentence in the slot. */
export const SentenceParts = ({ labels, parts, onOpenSlot }: SentencePartsProps) => (
  <>
    {parts.map(part => {
      if (part.kind === "text") return <span key={part.key}>{part.text}</span>;
      if (part.children) return (
        <span className="script-slot script-slot--nested" data-error={part.error} data-linked={part.linked}
          key={part.key}>
          <button aria-label={part.label} className="script-slot__change" title={part.label} type="button"
            onClick={() => onOpenSlot(part.part)}>ƒ</button>
          <SentenceParts labels={labels} parts={part.children} onOpenSlot={onOpenSlot} />
        </span>
      );
      return (
        <button className="script-slot" data-empty={!part.summary} data-error={part.error}
          data-linked={part.linked} key={part.key} title={part.label} type="button"
          onClick={() => onOpenSlot(part.part)}>
          {part.summary}
          {!part.summary && part.optional && labels.any}
          {!part.summary && !part.optional && labels.unset}
        </button>
      );
    })}
  </>
);

interface IssueListProps {
  issues: readonly ShownIssue[];
}
/** The row's own messages (errors red, warnings amber, notes muted). */
export const IssueList = ({ issues }: IssueListProps) => {
  if (!issues.length) return null;
  return (
    <ul className="script-issues">
      {issues.map((issue, index) => (
        <li data-severity={issue.severity} key={`${index}:${issue.text}`}>{issue.text}</li>
      ))}
    </ul>
  );
};

interface MenuButtonProps {
  label: string;
  onClick: () => void;
}
const MenuButton = ({ label, onClick }: MenuButtonProps) => (
  <button role="menuitem" type="button" onClick={onClick}>{label}</button>
);

interface RowMenuProps {
  canInvert?: boolean;
  disabled: boolean;
  isStep: boolean;
  labels: FormLabels;
  path: NodePath;
  steps: StepCommands;
  onCommentEdit?: () => void;
}
/** The ⋯ menu of a row (design §13.2): move, duplicate, off/on, comment, copy, cut, delete, wrap, wording. */
export const RowMenu = ({ canInvert, disabled, isStep, labels, path, steps, onCommentEdit }: RowMenuProps) => {
  const { menu } = labels;
  return (
    <details className="script-menu">
      <summary aria-label={menu.label} title={menu.label}>⋯</summary>
      <div className="script-menu__items" role="menu">
        <MenuButton label={menu.moveUp} onClick={() => steps.onMove(path, -1)} />
        <MenuButton label={menu.moveDown} onClick={() => steps.onMove(path, 1)} />
        <MenuButton label={menu.duplicate} onClick={() => steps.onDuplicate(path)} />
        {canInvert && <MenuButton label={menu.invert} onClick={() => steps.onInvert(path)} />}
        {isStep && disabled && <MenuButton label={menu.enable} onClick={() => steps.onToggle(path)} />}
        {isStep && !disabled && <MenuButton label={menu.disable} onClick={() => steps.onToggle(path)} />}
        {isStep && onCommentEdit && <MenuButton label={menu.comment} onClick={onCommentEdit} />}
        {isStep && <MenuButton label={menu.copy} onClick={() => steps.onCopy(path)} />}
        {isStep && <MenuButton label={menu.cut} onClick={() => steps.onCut(path)} />}
        {isStep && <MenuButton label={menu.wrapIf} onClick={() => steps.onWrap(path, "if")} />}
        {isStep && <MenuButton label={menu.wrapForEach} onClick={() => steps.onWrap(path, "forEach")} />}
        <MenuButton label={menu.delete} onClick={() => steps.onDelete(path)} />
      </div>
    </details>
  );
};

interface SentenceRowProps {
  block: ShownBlock;
  children?: ReactNode;
  depth: number;
  labels: FormLabels;
  menu: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLLIElement>) => void;
  onOpenSlot: (part: SlotPart) => void;
}
/** One sentence row: indent, the sentence, its menu, options below and its messages (red underline on errors). */
export const SentenceRow = ({ block, children, depth, labels, menu, onKeyDown, onOpenSlot }: SentenceRowProps) => (
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Ctrl+D / Ctrl+/ of row buttons
  <li className="script-row" data-depth={depth} data-disabled={block.disabled} data-error={block.hasError}
    data-linked={block.linked} ref={scrollIntoViewWhen(block.linked)} onKeyDown={onKeyDown}>
    <div className="script-row__line">
      <span className="script-row__sentence"><SentenceParts labels={labels} parts={block.parts}
        onOpenSlot={onOpenSlot} /></span>
      {block.disabled && <span className="script-row__off">{labels.menu.off}</span>}
      {menu}
    </div>
    {block.comment && <p className="script-row__comment">{block.comment}</p>}
    {children}
    <IssueList issues={block.issues} />
  </li>
);
