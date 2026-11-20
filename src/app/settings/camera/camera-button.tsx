import type { MouseEvent, PointerEvent } from "react";

import { LabelledButton } from "../../components/labelled-button";
import { CameraIconImage } from "../camera-icon-image";
import { type CameraIcon, getCameraIconSource } from "../camera-icons";

interface CameraButtonProps {
  className: string;
  disabled?: boolean;
  gridArea?: string;
  icon: CameraIcon;
  label: string;
  pressed?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerRelease?: () => void;
}
/** A camera panel button: its rendered icon, the label as accessible name and tooltip. */
export const CameraButton = ({
  className, disabled, gridArea, icon, label, pressed,
  onClick, onPointerDown, onPointerRelease
}: CameraButtonProps) => (
  <LabelledButton
    className={className}
    disabled={disabled}
    label={label}
    pressed={pressed}
    style={{ gridArea }}
    onClick={onClick}
    onPointerDown={onPointerDown}
    onPointerRelease={onPointerRelease}
  >
    <CameraIconImage source={getCameraIconSource(icon)} />
  </LabelledButton>
);
