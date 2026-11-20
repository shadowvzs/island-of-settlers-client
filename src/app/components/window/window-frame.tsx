import { useLingui } from "@lingui/react";
import type { ReactNode, Ref } from "react";

import { joinClassNames } from "../helpers";
import { IconButton } from "../icon-button";
import type { DataAttributes } from "../labelled-button";
import { SettlementIcon } from "../settlement-icon";
import { getWindowFrameLabels } from "./helpers";
import { useWindowFrame, type WindowFrameBehaviour } from "./use-window-frame";

interface WindowHeaderProps {
  handleRef: Ref<HTMLDivElement>;
  name: string;
  title: string;
  titleId: string;
  onClose: () => void;
}
/** Drag handle with the title, and the close button, both named after the window. */
const WindowHeader = ({ handleRef, name, title, titleId, onClose }: WindowHeaderProps) => {
  const { i18n } = useLingui();
  const labels = getWindowFrameLabels(name, i18n);
  return (
    <header className="settlement-ui__panel-header">
      <div aria-label={labels.move} className="settlement-ui__drag-handle" ref={handleRef} role="button" tabIndex={0}>
        <SettlementIcon name="drag" />
        <h2 id={titleId}>{title}</h2>
      </div>
      <IconButton caption="" icon="cancel" label={labels.close} onClick={onClose} />
    </header>
  );
};

export interface WindowFrameProps extends WindowFrameBehaviour {
  children?: ReactNode;
  /** Classes besides `settlement-ui__panel`. */
  className?: string;
  data?: DataAttributes;
  /** Lower-case window name of the drag and close labels. */
  name: string;
  title: string;
  titleId: string;
  onClose: () => void;
}
/**
 * The shared movable window (`section.settlement-ui__panel`, a dialog labelled by its title): header with drag
 * handle and close button, then the content. Visibility comes from the owner; the frame drags, raises and focuses.
 */
export const WindowFrame = ({
  children, className, content, data, name, opened, title, titleId, visible, focusOnOpen, onClose, onOpened
}: WindowFrameProps) => {
  const { handleRef, panelRef } = useWindowFrame({ content, focusOnOpen, opened, visible, onOpened });
  return (
    <section
      aria-labelledby={titleId}
      className={joinClassNames("settlement-ui__panel", className)}
      hidden={!visible}
      ref={panelRef}
      role="dialog"
      {...data}
    >
      <WindowHeader handleRef={handleRef} name={name} title={title} titleId={titleId} onClose={onClose} />
      {children}
    </section>
  );
};
