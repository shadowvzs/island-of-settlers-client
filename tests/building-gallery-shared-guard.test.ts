import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { gallerySourceGuard } from "../tools/bench/building-gallery-source";

it("guards actual external shared building dependencies without enrolling unrelated shared modules",()=>{
  const guard=gallerySourceGuard(),path="../island-of-settlers-shared/src/building-types.ts";
  guard.request(new URL(`/@fs${resolve(path)}`,"http://localhost").href);
  const manifest=guard.finish();
  expect(manifest.stable).toBe(true);
  expect(Object.keys(manifest.files).filter(file=>file.startsWith("../island-of-settlers-shared/src/"))).toEqual([path]);
  expect(manifest.files[path]!.sha256).toMatch(/^[0-9a-f]{64}$/);
});

it("hashes real imported src UI binaries before browser startup instead of comparing with undefined", () => {
  const guard = gallerySourceGuard(), path = "src/app/assets/loading-cloud.webp";
  guard.request(`http://localhost/${path}?import`);
  const manifest = guard.finish();
  expect(manifest.stable, manifest.errors.join("\n")).toBe(true);
  expect(manifest.files[path]!.sha256).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
  expect(manifest.files["src/app/assets/loading-smoke.webp"]).toBeUndefined();
});

it("rejects a requested src binary that changes after its initial snapshot", () => {
  const folder = mkdtempSync("src/app/assets/gallery-guard-fixture-"), path = `${folder}/texture.webp`;
  try {
    writeFileSync(path, new Uint8Array([1, 2, 3]));
    const guard = gallerySourceGuard();
    guard.request(`http://localhost/${path}`);
    writeFileSync(path, new Uint8Array([3, 2, 1]));
    const manifest = guard.finish();
    expect(manifest.stable).toBe(false);
    expect(manifest.errors).toContain(`Requested source/asset changed before closure: ${path}`);
  } finally { rmSync(folder, { recursive: true }); }
});
