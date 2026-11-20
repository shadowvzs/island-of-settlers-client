import { HUD_SCOPE_ATTRIBUTES } from "./constants";

import "./hud-scope.css";

/** Why the normal HUD is hidden; each reason owns its own root attribute and stylesheet rules. */
export type HudScopeReason = keyof typeof HUD_SCOPE_ATTRIBUTES;

export interface HudScopeRoot {
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  setAttribute: (name: string, value: string) => void;
}

export interface HudScope {
  dispose: () => void;
  hidden: () => boolean;
  restoreCount: () => number;
  /** Hide (true) or restore (false) the HUD for this scope's reason; idempotent. */
  set: (hide: boolean) => void;
}

/**
 * Owns one root attribute that scoped CSS uses to hide the normal HUD/windows. It never closes a window, clears a
 * draft or rewrites a store flag; restoring puts the attribute back to the value it had when the scope was created,
 * so every owner's open state returns exactly. Two reasons (exploration, cinematic) use separate attributes and so
 * never undo each other, in any order. Non-destructive and idempotent.
 */
export const createHudScope = (reason: HudScopeReason, root?: HudScopeRoot | null): HudScope => {
  const { attribute, value } = HUD_SCOPE_ATTRIBUTES[reason];
  const original = root?.getAttribute(attribute) ?? null;
  let active = false;
  let disposed = false;
  let restorations = 0;

  const restore = () => {
    if (!active || !root) {
      active = false;
      return;
    }
    if (original === null) root.removeAttribute(attribute);
    else root.setAttribute(attribute, original);
    active = false;
    restorations++;
  };

  const set = (hide: boolean) => {
    if (disposed || hide === active) return;
    if (!hide) {
      restore();
      return;
    }
    root?.setAttribute(attribute, value);
    active = true;
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      restore();
    },
    hidden: () => active,
    restoreCount: () => restorations,
    set
  };
};

/** True while any reason (cinematic, possessed view) hides the normal HUD on this root. */
export const isHudScopeHidden = (root: Pick<HudScopeRoot, "getAttribute"> = document.documentElement) =>
  Object.values(HUD_SCOPE_ATTRIBUTES).some(({ attribute, value }) => root.getAttribute(attribute) === value);
