import type { KeyboardEvent, ReactNode } from "react";

import { focusOnMount } from "./focus";
import { ScriptIconButton } from "./icon-button";
import type { ScriptWorkspace } from "./script-workspace";
import { useAddMenu } from "./use-add-menu";
import type { AddRequest } from "./use-script-dialogs";

const closeOnEscape = (onClose: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  onClose();
};

interface ScriptDialogProps {
  children: ReactNode;
  closeLabel: string;
  footer?: ReactNode;
  title: string;
  onClose: () => void;
}
/** A dialog layered over the workspace (inside its window): title, close, scrolling body, footer; Escape closes. */
export const ScriptDialog = ({ children, closeLabel, footer, title, onClose }: ScriptDialogProps) => (
  <div className="script-dialog__backdrop">
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes only this dialog */}
    <section aria-label={title} aria-modal="false" className="script-dialog" role="dialog"
      onKeyDown={closeOnEscape(onClose)}>
      <header className="script-dialog__header">
        <h3>{title}</h3>
        <ScriptIconButton className="script-dialog__close" icon="close" label={closeLabel} onClick={onClose} />
      </header>
      <div className="script-dialog__body">{children}</div>
      {footer && <footer className="script-dialog__footer">{footer}</footer>}
    </section>
  </div>
);

interface AddMenuProps {
  request: AddRequest;
  workspace: ScriptWorkspace;
  onClose: () => void;
}
/** "+ event" / "+ condition" / "+ action": grouped sentence options with a search; one click adds. */
export const AddMenu = ({ request, workspace, onClose }: AddMenuProps) => {
  const view = useAddMenu(workspace, request, onClose);
  return (
    <ScriptDialog closeLabel={view.cancelLabel} title={view.title} onClose={view.onClose}>
      <input aria-label={view.searchLabel} className="script-dialog__search" placeholder={view.searchLabel}
        ref={focusOnMount}
        type="search" value={view.query} onChange={event => view.onQueryChange(event.target.value)} />
      {view.groups.map(group => (
        <section className="script-add__group" key={group.id}>
          <h4>{group.label}</h4>
          <ul>
            {group.options.map(option => (
              <li key={option.key}>
                <button className="script-add__option" type="button" onClick={() => view.onChoose(option.key)}>
                  {option.label}
                  {option.laterText && <span className="script-add__later">{option.laterText}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </ScriptDialog>
  );
};
