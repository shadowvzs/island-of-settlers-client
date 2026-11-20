/** Normalized movement intent: forward is +1 away from the eye, right is +1 to the eye's right. */
export interface MovementIntent {
  forward: number;
  right: number;
}

export const ZERO_MOVEMENT: Readonly<MovementIntent> = Object.freeze({ forward: 0, right: 0 });

/** Below this fraction of the pad the touch rests: no accidental walking. */
export const JOYSTICK_DEADZONE = 0.14;

const clampAxis = (value: number) => Math.max(-1, Math.min(1, value));

/** Keeps a combined keyboard + joystick intent inside the unit circle. */
export const clampMovement = (intent: MovementIntent): MovementIntent => {
  const length = Math.hypot(intent.forward, intent.right);
  if (length <= 1) return { forward: clampAxis(intent.forward), right: clampAxis(intent.right) };
  return { forward: intent.forward / length, right: intent.right / length };
};

/**
 * A joystick drag relative to the pad centre, in CSS pixels. The deadzone is removed and the remaining
 * travel is rescaled, so the stick walks as soon as it leaves the centre and reaches full speed at the rim.
 */
export const joystickMovement = (
  deltaX: number,
  deltaY: number,
  radius: number,
  deadzone = JOYSTICK_DEADZONE
): MovementIntent => {
  if (radius <= 0) return { ...ZERO_MOVEMENT };
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= 0) return { ...ZERO_MOVEMENT };
  const strength = Math.min(1, distance / radius);
  if (strength <= deadzone) return { ...ZERO_MOVEMENT };
  const scaled = (strength - deadzone) / (1 - deadzone);
  const scale = scaled / distance;
  return { forward: -deltaY * scale, right: deltaX * scale };
};

const MOVEMENT_KEYS: Readonly<Record<string, MovementIntent>> = Object.freeze({
  ArrowDown: { forward: -1, right: 0 },
  ArrowUp: { forward: 1, right: 0 }
});

const movementKey = (code: string) => MOVEMENT_KEYS[code];

/** The movement a key code contributes, or null for every other key. */
export const movementForKey = (code: string): MovementIntent | null => {
  const direction = movementKey(code);
  return direction ? { ...direction } : null;
};

/** Held arrow keys as one intent; a diagonal is clamped later with the joystick. */
export const keyboardMovement = (pressedKeys: ReadonlySet<string>): MovementIntent => {
  let forward = 0;
  let right = 0;
  for (const code of pressedKeys) {
    const direction = movementKey(code);
    if (!direction) continue;
    forward += direction.forward;
    right += direction.right;
  }
  return { forward, right };
};

export const combineMovement = (
  keyboard: MovementIntent,
  joystick: MovementIntent
): MovementIntent => clampMovement({
  forward: keyboard.forward + joystick.forward,
  right: keyboard.right + joystick.right
});

export const movementEquals = (left: MovementIntent, right: MovementIntent) =>
  left.forward === right.forward && left.right === right.right;

interface TextEntryTarget {
  isContentEditable?: boolean;
  tagName?: string;
}

/** Keyboard events inside a text field belong to that field, not to the explorer. */
export const isTextEntryTarget = (target: unknown) => {
  if (!target || typeof target !== "object") return false;
  const candidate = target as TextEntryTarget;
  return candidate.isContentEditable === true ||
    /^(INPUT|SELECT|TEXTAREA)$/.test(candidate.tagName ?? "");
};
