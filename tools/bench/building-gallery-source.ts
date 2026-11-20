import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const filesIn = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
  const path = `${folder}/${entry.name}`;
  return entry.isDirectory() ? filesIn(path) : [path];
});
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const stamp = (path: string) => {
  const value = statSync(path);
  return `${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
};

/** Snapshot before browser startup, then guard only the graph actually requested by the showcase. */
export interface GallerySourceSnapshot { files: Record<string, string>; assets: Record<string, string>; policy: string }
export const gallerySourceGuard = (baseline?: GallerySourceSnapshot) => {
  const root = resolve("."), sources = [...filesIn("src"), ...filesIn("tools/bench"),
    ...(existsSync("../island-of-settlers-shared/src") ? filesIn("../island-of-settlers-shared/src") : [])];
  // Vite also serves imported images/fonts from src. Snapshot their real bytes before startup,
  // while request() still enrolls only dependencies actually loaded by this review.
  for (const path of ["building-showcase.html", "package.json", "package-lock.json"]) if (existsSync(path)) sources.push(path);
  const initialSources = new Map(sources.map(path => [path, sha(path)]));
  const initialAssets = new Map(filesIn("assets").map(path => [path, stamp(path)]));
  const requested = new Map<string, { sha256: string; bytes: number }>(), errors: string[] = [];
  const incidentalVersions: Record<string, { sha256: string; changedDuringCapture?: boolean }> = {};
  for (const path of sources.filter(path => path.startsWith("tools/bench/building-gallery") ||
    ["tools/bench/building-integrated-gallery.ts", "tools/bench/browser.ts", "tools/bench/chrome.ts"].includes(path)))
    requested.set(path, { sha256: initialSources.get(path)!, bytes: statSync(path).size });
  for (const path of ["package.json", "package-lock.json", "building-showcase.html"]) if (initialSources.has(path))
    requested.set(path, { sha256: initialSources.get(path)!, bytes: statSync(path).size });
  const request = (url: string) => {
    const pathname = decodeURIComponent(new URL(url).pathname);
    let path = pathname.replace(/^\//, "");
    if (pathname.startsWith("/@fs/")) path = relative(root, pathname.slice(4));
    // isWorkerNation imports this unrelated civilian roster; no body from it is rendered here.
    if (path === "../island-of-settlers-worker-generation/src/tripo-roster.ts" && existsSync(path)) {
      incidentalVersions[path] ??= { sha256: sha(path) };
      return;
    }
    if (!/^(src|assets|tools\/bench|\.\.\/island-of-settlers-shared\/src)\//.test(path) || requested.has(path) || !existsSync(path)) return;
    try {
      const digest = sha(path);
      if (path.startsWith("assets/")) assert.equal(stamp(path), initialAssets.get(path), `Asset changed since start: ${path}`);
      else assert.equal(digest, initialSources.get(path), `Source changed since start: ${path}`);
      if (baseline) {
        if (path.startsWith("assets/")) assert.equal(stamp(path), baseline.assets[path], `Building asset changed since gallery baseline: ${path}`);
        else assert.equal(digest, baseline.files[path], `Requested dependency changed since gallery baseline: ${path}`);
      }
      requested.set(path, { sha256: digest, bytes: statSync(path).size });
    } catch (error) { errors.push(String(error)); }
  };
  const finish = () => {
    for (const [path, value] of requested) {
      if (!existsSync(path) || sha(path) !== value.sha256) errors.push(`Requested source/asset changed before closure: ${path}`);
      if (baseline && !path.startsWith("assets/") && baseline.files[path] !== value.sha256)
        errors.push(`Requested dependency differs from gallery baseline: ${path}`);
    }
    for (const [path, value] of Object.entries(incidentalVersions)) value.changedDuringCapture = sha(path) !== value.sha256;
    return { files: Object.fromEntries([...requested].sort(([a], [b]) => a.localeCompare(b))), incidentalVersions, errors,
      stable: errors.length === 0, policy: "Requested local canonical source/assets guarded from pre-browser snapshot through final capture; unused private trees and old library files are not loaded." };
  };
  const prepared = (): GallerySourceSnapshot => ({ files: Object.fromEntries(initialSources), assets: Object.fromEntries(initialAssets),
    policy: "CPU preparation snapshot of canonical src and bench code only, not proof of native image freshness. The native run separately guards the actually requested source/assets from its own fresh start." });
  return { finish, prepared, request };
};

export const validateGallerySourceFiles = (files: Record<string, { sha256: string; bytes: number }>) =>
  Object.entries(files).filter(([path, value]) => !existsSync(path) || sha(path) !== value.sha256).map(([path]) => path);
