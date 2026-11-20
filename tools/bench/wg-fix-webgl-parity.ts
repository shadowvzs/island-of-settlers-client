import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { prepareBase, removeBaseWorktree, repositoryRoot } from "./ab-worktree";

/** One-off WG-FIX-1 evidence: capture the frozen WebGL frames on master and on the lane, then diff. */
const SLOT = "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures/browser-slot.sh";
const OUT = "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures/wg-fix-1/webgl-parity";

const run = (root: string, env: Record<string, string>) => new Promise<number>(done => {
  const child = spawn(SLOT, ["npx", "tsx", "tools/bench/wg0-webgl-parity.ts"], {
    cwd: join(root, "island-of-settlers-client"),
    env: { ...process.env, ...env },
    stdio: "inherit"
  });
  child.on("close", code => done(code ?? 1));
});

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const laneRoot = repositoryRoot(process.cwd());
  const base = prepareBase(laneRoot, "master");
  try {
    // The base worktree predates WG-0: give it the same capture tool without touching its source.
    for (const name of ["atmosphere-frame-snapshot.ts", "atmosphere-live-cost-patch.ts",
      "frozen-frame-review.ts", "parity-helpers.ts", "wg0-webgl-parity.ts"])
      copyFileSync(join(laneRoot, "island-of-settlers-client/tools/bench", name),
        join(base.root, "island-of-settlers-client/tools/bench", name));
    const baseOut = join(OUT, "base");
    rmSync(baseOut, { force: true, recursive: true });
    mkdirSync(baseOut, { recursive: true });
    // Let the base create the seed with its own save format, then reuse that exact save in the lane.
    const baseCode = await run(base.root, { OUTPUT_DIR: baseOut, PARITY_NO_POST: "1" });
    const baseSide = readdirSync(baseOut).find(name => !name.endsWith(".json"))!;
    const laneOut = join(OUT, "lane");
    mkdirSync(laneOut, { recursive: true });
    copyFileSync(join(baseOut, "seed-123-save.json"), join(laneOut, "seed-123-save.json"));
    const laneCode = await run(laneRoot, { OUTPUT_DIR: laneOut,
      PARITY_BASE_DIR: join(baseOut, baseSide), PARITY_NO_POST: "1" });
    writeFileSync(join(OUT, "result.json"), JSON.stringify({ baseCode, baseCommit: base.commit, baseSide,
      laneCode }, null, 2));
  } finally {
    removeBaseWorktree(laneRoot, base);
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
