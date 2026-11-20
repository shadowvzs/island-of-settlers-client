import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Temporary base checkout for the A/B perf runner (TOOL-4). A git ref becomes a detached sparse worktree on the large
 * drive (without `resources/`), with the lane's dependency links copied as symlinks; `removeBaseWorktree` deletes
 * only the symlinks it created (lstat checked, never followed) and then runs `git worktree remove` without `--force`.
 */

export const LARGE_DRIVE_WORKTREES = "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree";

/** Folders, relative to the repository root, whose dependency links the base checkout needs. */
const LINKED_PATHS = [
  "node_modules",
  "island-of-settlers-client/node_modules",
  "island-of-settlers-shared/node_modules",
  "island-of-settlers-worker-generation"
];

export interface BaseCheckout {
  /** Symlinks this tool created (absolute paths inside `root`). */
  links: string[];
  /** Resolved commit of the ref. */
  commit: string;
  /** True when this tool created the worktree and must remove it. */
  owned: boolean;
  root: string;
}

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export const repositoryRoot = (path: string) => git(path, ["rev-parse", "--show-toplevel"]);

export const commitOf = (root: string, ref = "HEAD") => git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);

/** Branch name of a checkout, or "detached". */
export const branchOf = (root: string) => {
  const name = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return name === "HEAD" ? "detached" : name;
};

/** Tracked files changed in the checkout (untracked files are ignored). */
export const hasLocalChanges = (root: string) =>
  git(root, ["status", "--porcelain", "--untracked-files=no"]).length > 0;

const isInside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
};

/** Target the lane uses for a dependency path: its own symlink target, else the lane's real folder. */
const linkTargetOf = (laneRoot: string, path: string) => {
  const lanePath = join(laneRoot, path);
  if (!existsSync(lanePath)) return null;
  const stats = lstatSync(lanePath);
  if (!stats.isSymbolicLink()) return lanePath;
  return resolve(dirname(lanePath), readlinkSync(lanePath));
};

const linkDependencies = (laneRoot: string, root: string) => {
  const links: string[] = [];
  for (const path of LINKED_PATHS) {
    const target = linkTargetOf(laneRoot, path);
    const link = join(root, path);
    if (!target || existsSync(link) || !existsSync(dirname(link))) continue;
    symlinkSync(target, link);
    links.push(link);
  }
  return links;
};

const worktreeRootFor = () => existsSync(LARGE_DRIVE_WORKTREES) ? LARGE_DRIVE_WORKTREES : null;

/**
 * A base given as an existing folder is used as is (never removed); a git ref gets a fresh detached sparse worktree.
 */
export const prepareBase = (laneRoot: string, base: string, parent = worktreeRootFor()): BaseCheckout => {
  if (existsSync(base) && lstatSync(base).isDirectory()) {
    const root = repositoryRoot(base);
    return { commit: commitOf(root), links: [], owned: false, root };
  }
  const commit = commitOf(laneRoot, base);
  if (!parent) throw new Error(`No worktree folder: ${LARGE_DRIVE_WORKTREES} is not mounted; pass --worktree-root`);
  const root = join(parent, `ab-base-${commit.slice(0, 9)}-${process.pid}`);
  if (existsSync(root)) throw new Error(`${root} already exists`);
  git(laneRoot, ["worktree", "add", "--detach", "--no-checkout", root, commit]);
  git(root, ["sparse-checkout", "set", "--no-cone", "/*", "!/resources/"]);
  git(root, ["read-tree", "-mu", "HEAD"]);
  return { commit, links: linkDependencies(laneRoot, root), owned: true, root };
};

/** Deletes the created symlinks (only if still symlinks inside the worktree), then `git worktree remove`. */
export const removeBaseWorktree = (laneRoot: string, checkout: BaseCheckout) => {
  if (!checkout.owned) return { removed: false, reason: "not owned" };
  const root = resolve(checkout.root);
  for (const link of checkout.links) {
    if (!isInside(root, resolve(link))) continue;
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
    } catch { /* already gone */ }
  }
  try {
    git(laneRoot, ["worktree", "remove", root]);
    return { removed: true, reason: "" };
  } catch (error) {
    return { removed: false, reason: (error as Error).message.split("\n")[0] };
  }
};
