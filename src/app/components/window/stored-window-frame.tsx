import type { ReactNode } from "react";

import { useExternalStore } from "../external-store";
import { WindowFrame } from "./window-frame";
import type { WindowFrameMountProps } from "./window-frame-controller";

interface StoredWindowFrameProps extends WindowFrameMountProps {
  children?: ReactNode;
}
/** The shared window frame shown, titled and opened from its controller's state store. */
export const StoredWindowFrame = ({
  children, className, content, data, id, name, state, onClose, onOpened
}: StoredWindowFrameProps) => {
  const { name: liveName, opened, title, visible } = useExternalStore(state);
  return (
    <WindowFrame
      className={className}
      content={content}
      data={data}
      name={liveName ?? name}
      opened={opened}
      title={title}
      titleId={id}
      visible={visible}
      onClose={onClose}
      onOpened={onOpened}
    >
      {children}
    </WindowFrame>
  );
};
