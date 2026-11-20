import type { CSSProperties, MouseEvent, PointerEvent, ReactNode, Ref } from "react";

/** `data-*` attributes the drivers and tests query (e.g. `data-storage-tool`). */
export type DataAttributes = Readonly<Record<`data-${string}`, string>>;

interface LabelledButtonProps {
  children: ReactNode;
  className: string;
  data?: DataAttributes;
  disabled?: boolean;
  expanded?: boolean;
  hasPopup?: "dialog" | "true";
  hidden?: boolean;
  /** Accessible name; also the tooltip unless `title` is given. */
  label: string;
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
  style?: CSSProperties;
  title?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  /** Pointer up, cancel or lost capture (press-and-hold buttons). */
  onPointerRelease?: () => void;
}
/** The shared skeleton of the icon buttons: a plain button named by its label, its content as children. */
export const LabelledButton = ({
  children, className, data, disabled, expanded, hasPopup, hidden, label, pressed, ref, style, title = label,
  onClick, onPointerDown, onPointerRelease
}: LabelledButtonProps) => (
  <button
    aria-expanded={expanded}
    aria-haspopup={hasPopup}
    aria-label={label}
    aria-pressed={pressed}
    className={className}
    disabled={disabled}
    hidden={hidden}
    ref={ref}
    style={style}
    title={title}
    type="button"
    onClick={onClick}
    onLostPointerCapture={onPointerRelease}
    onPointerCancel={onPointerRelease}
    onPointerDown={onPointerDown}
    onPointerUp={onPointerRelease}
    {...data}
  >
    {children}
  </button>
);
