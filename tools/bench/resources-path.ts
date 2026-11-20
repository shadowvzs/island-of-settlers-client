import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** game/island-of-settlers-client/tools/bench → game/; a worktree lives under game/.claude/worktrees/<name>/. */
const findGameRoot = () => {
  const gameRoot = resolve(import.meta.dirname, "../../..");
  const worktree = gameRoot.indexOf("/.claude/worktrees/");
  return worktree >= 0 ? gameRoot.slice(0, worktree) : gameRoot;
};

/**
 * Resources inside the game workspace, also when a tool runs from a git worktree.
 * Throws instead of silently creating a stray output folder.
 */
export const resourcesPath = (...parts: string[]) => {
  const resources = resolve(findGameRoot(), "resources");
  if (!existsSync(resources)) throw new Error(`Workspace resources folder not found: ${resources}`);
  return resolve(resources, ...parts);
};
