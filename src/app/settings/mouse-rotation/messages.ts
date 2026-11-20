import { msg } from "@lingui/core/macro";

export const MOUSE_ROTATION_MESSAGES = {
  label: msg({ id: "settings.mouseRotation.label", message: "Mouse rotation" }),
  rotations: {
    middle: msg({ id: "settings.mouseRotation.middle", message: "Middle drag" }),
    off: msg({ id: "settings.mouseRotation.off", message: "Off" }),
    right: msg({ id: "settings.mouseRotation.right", message: "Right drag" })
  },
  title: msg({ id: "settings.mouseRotation.title", message: "Camera rotation" })
};
