const icons = import.meta.glob("../../../assets/ui-icons/camera/*.png", {
  eager: true, import: "default", query: "?url"
}) as Record<string, string>;

export type CameraIcon = "camera" | "down" | "left" | "minus" | "pitch-down" | "pitch-up" |
  "plus" | "reset" | "right" | "rotate-left" | "rotate-right" | "up";

/** Rendered camera icon of the camera panel buttons and the corner Camera controls button. */
export const getCameraIconSource = (name: CameraIcon) => icons[`../../../assets/ui-icons/camera/${name}.png`]!;

