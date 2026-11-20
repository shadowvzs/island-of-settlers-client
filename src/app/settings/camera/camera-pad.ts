import type { I18n } from "@lingui/core";

import { panByScreen } from "../../../render-common/camera-controller";
import { type CameraState,clampCamera } from "../../../render-common/camera-state";
import { translateMessage } from "../../../shared/i18n/translate";
import { clampTilt } from "../../camera-bookmarks";
import type { CameraIcon } from "../camera-icons";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";
import { createHoldRepeat, type HoldRepeat } from "./hold-repeat";

/** Screen pixels per second of a held move button. */
const MOVE_SPEED = 500;
/** Radians per second of a held rotate / pitch button. */
const ROTATE_SPEED = 1.4;
const PITCH_SPEED = 0.7;

/** One hold-to-repeat camera button: its icon, accessible name and optional pad cell. */
export interface CameraPadButton {
  gridArea?: string;
  hold: HoldRepeat;
  icon: CameraIcon;
  label: string;
}

/**
 * The move pad and rotate / pitch buttons. Moves reuse the drag / keyboard projection, so they follow the
 * current camera rotation; each button's hold loop mutates the camera directly (no React state).
 */
export const createCameraPad = (camera: CameraState, mapSize: readonly [number, number], i18n?: I18n) => {
  const move = (x: number, y: number) => (seconds: number) => {
    panByScreen(camera, x * seconds * MOVE_SPEED, y * seconds * MOVE_SPEED);
    clampCamera(camera, ...mapSize);
  };
  const rotate = (direction: number) => (seconds: number) => { camera.yaw += direction * seconds * ROTATE_SPEED; };
  const pitch = (direction: number) => (seconds: number) => {
    camera.tilt = clampTilt(camera.tilt + direction * seconds * PITCH_SPEED);
  };
  const button = (label: string, icon: CameraIcon, apply: (seconds: number) => void, gridArea?: string) =>
    ({ gridArea, hold: createHoldRepeat(apply), icon, label });
  return {
    moves: [
      button(translateMessage(i18n, M.camera.moveUp), "up", move(0, -1), "1 / 2"),
      button(translateMessage(i18n, M.camera.moveLeft), "left", move(-1, 0), "2 / 1"),
      button(translateMessage(i18n, M.camera.moveRight), "right", move(1, 0), "2 / 3"),
      button(translateMessage(i18n, M.camera.moveDown), "down", move(0, 1), "3 / 2")
    ],
    rotations: [
      button(translateMessage(i18n, M.camera.rotateLeft), "rotate-left", rotate(1)),
      button(translateMessage(i18n, M.camera.rotateRight), "rotate-right", rotate(-1)),
      button(translateMessage(i18n, M.camera.pitchUp), "pitch-up", pitch(-1)),
      button(translateMessage(i18n, M.camera.pitchDown), "pitch-down", pitch(1))
    ]
  };
};

export type CameraPad = ReturnType<typeof createCameraPad>;
