/** Transient vertical motion for the possessed presentation body; no simulation actor or navigation changes. */
export const EXPLORATION_JUMP_HEIGHT = .5;
export const EXPLORATION_JUMP_GRAVITY = 9.8;
export const EXPLORATION_JUMP_TAKEOFF = .08;
export const EXPLORATION_JUMP_LANDING = .14;
export const EXPLORATION_JUMP_HEAD_MARGIN = .015;

export interface ExplorationJump {
  phase: "takeoff" | "air" | "landing";
  elapsed: number;
  feetY: number;
  velocity: number;
}

export const beginExplorationJump = (ground: number): ExplorationJump =>
  ({ phase: "takeoff", elapsed: 0, feetY: ground, velocity: 0 });

/** Integrates bounded substeps, catching upward head contact and the actual landing surface. */
export const advanceExplorationJump = (
  jump: ExplorationJump, ground: number, ceiling: number, bodyHeight: number, seconds: number
): ExplorationJump | null => {
  if (!(seconds > 0) || !Number.isFinite(ground)) return jump;
  let remaining = Math.min(seconds, .25);
  const next = { ...jump };
  const headLimit = Number.isFinite(ceiling) ? Math.max(ground, ceiling - bodyHeight - EXPLORATION_JUMP_HEAD_MARGIN) : Infinity;
  while (remaining > 1e-9) {
    const dt = Math.min(.02, remaining); remaining -= dt;
    next.elapsed += dt;
    if (next.phase === "takeoff") {
      next.feetY = ground;
      if (next.elapsed >= EXPLORATION_JUMP_TAKEOFF - 1e-9) {
        next.phase = "air"; next.elapsed = 0;
        next.velocity = Math.sqrt(2 * EXPLORATION_JUMP_GRAVITY * EXPLORATION_JUMP_HEIGHT);
      }
    } else if (next.phase === "air") {
      const y = next.feetY + next.velocity * dt - .5 * EXPLORATION_JUMP_GRAVITY * dt * dt;
      next.velocity -= EXPLORATION_JUMP_GRAVITY * dt;
      if (y > headLimit) { next.feetY = headLimit; next.velocity = Math.min(0, next.velocity); }
      else next.feetY = y;
      if (next.feetY <= ground) {
        next.feetY = ground; next.velocity = 0; next.phase = "landing"; next.elapsed = 0;
      }
    } else {
      next.feetY = ground;
      if (next.elapsed >= EXPLORATION_JUMP_LANDING - 1e-9) return null;
    }
  }
  return next;
};

export const explorationJumpPose = (jump: ExplorationJump) => {
  let crouch = 0;
  if (jump.phase === "takeoff") crouch = Math.sin(Math.PI * jump.elapsed / EXPLORATION_JUMP_TAKEOFF) * .65;
  if (jump.phase === "landing") crouch = Math.sin(Math.PI * jump.elapsed / EXPLORATION_JUMP_LANDING);
  return { crouch, tuck: jump.phase === "air" ? Math.max(0, Math.min(1, .5 + jump.velocity / 6)) : 0 };
};
