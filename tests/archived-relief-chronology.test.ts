import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("automatically completes a filed owning island's physical relief, preserving full-save custody and replay proof", async () => {
  // The acceptance writes its receipts to OUT; the test keeps them out of the shared review folder.
  const output = await mkdtemp(join(tmpdir(), "relief-chronology-"));
  process.env.OUT = output;
  try {
    await expect(import("../tools/bench/relief-archive-chronology-acceptance")).resolves.toBeDefined();
  } finally {
    delete process.env.OUT;
    await rm(output, { force: true, recursive: true });
  }
}, 120_000);
