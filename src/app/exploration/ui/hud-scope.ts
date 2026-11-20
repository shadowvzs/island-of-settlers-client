import { HUD_SCOPE_ATTRIBUTES } from "../../hud-scope/constants";
import { createHudScope, type HudScopeRoot } from "../../hud-scope/hud-scope";
import { explorationInputPolicy, type ExplorationPhase } from "../contracts";

export const EXPLORATION_HUD_ATTRIBUTE = HUD_SCOPE_ATTRIBUTES.exploration.attribute;

/** The normal HUD is hidden while the frozen policy suppresses normal input (the active phases). */
export const shouldHideNormalHud = (phase: ExplorationPhase) =>
  explorationInputPolicy(phase).suppressNormal;

export type ExplorationHudScopeRoot = HudScopeRoot;

export interface ExplorationHudScope {
  dispose: () => void;
  hidden: () => boolean;
  restoreCount: () => number;
  sync: (phase: ExplorationPhase) => void;
}

/** The exploration reason of the shared HUD scope, driven by the exploration phase. */
export const createExplorationHudScope = (
  root?: ExplorationHudScopeRoot | null
): ExplorationHudScope => {
  const scope = createHudScope("exploration", root);
  return {
    dispose: scope.dispose,
    hidden: scope.hidden,
    restoreCount: scope.restoreCount,
    sync: phase => scope.set(shouldHideNormalHud(phase))
  };
};
