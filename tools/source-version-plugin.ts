import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

import { workerAssetFiles } from "./worker-asset-files.ts";

const VIRTUAL_ID = "virtual:source-version";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
    .sort();

/** Hash source and shipped assets; unreferenced worker reviews do not define a game version. */
export const hashSources = (directories: string[], workerAssets?: string) => {
  const hash = createHash("sha1");
  for (const directory of directories) {
    const files = directory === workerAssets
      ? workerAssetFiles(directory).map(file => join(directory, file)) : listFiles(directory);
    for (const file of files) {
      hash.update(file.slice(directory.length));
      hash.update(readFileSync(file));
    }
  }
  return hash.digest("hex").slice(0, 16);
};

/**
 * The folders a game build is made of. `simulation` holds the client source and the shared package source
 * (content catalog, building ids, decoration items): the server bundle imports both.
 */
export interface SourceFolders {
  assets: string;
  simulation: readonly string[];
  workerAssets: string;
  workerSource: string;
}

/** Shared package source, relative to the client package. */
export const SHARED_SOURCE_FOLDER = "../island-of-settlers-shared/src";

/** The one folder list Vite, the verifier build and the replay tools fingerprint. */
export const gameSourceFolders = (client: string, workerRepo: string): SourceFolders => ({
  assets: resolve(client, "assets"),
  simulation: [resolve(client, "src"), resolve(client, SHARED_SOURCE_FOLDER)],
  workerAssets: join(workerRepo, "game_ready"),
  workerSource: join(workerRepo, "src")
});

const listedFolders = (folders: SourceFolders) =>
  [...folders.simulation, folders.assets, folders.workerSource, folders.workerAssets];

/** Separate fingerprints identify whether simulation, shipped art, or worker code changed. */
export const sourceFingerprints = (folders: SourceFolders) => ({
  sourceVersion: hashSources(listedFolders(folders), folders.workerAssets),
  versions: { simulation: hashSources([...folders.simulation]),
    assets: hashSources([folders.assets]),
    workers: hashSources([folders.workerSource, folders.workerAssets], folders.workerAssets) }
});

/**
 * `virtual:source-version` exports SOURCE_VERSION, a hash of the source and asset trees: the
 * island cache keys on it, so a code or model change never serves stale islands. In dev the
 * module is invalidated on every change there (the next page load hashes again).
 */
export const sourceVersionPlugin = (folders: SourceFolders): Plugin => {
  const directories = listedFolders(folders);
  return {
    configureServer: (server) => {
      server.watcher.add(directories);
      server.watcher.on("all", (_event, file) => {
        if (!directories.some((directory) => file.startsWith(directory))) return;
        const module = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (module) server.moduleGraph.invalidateModule(module);
      });
    },
    load: (id) => {
      if (id !== RESOLVED_ID) return null;
      const fingerprints = sourceFingerprints(folders);
      return `export const SOURCE_VERSION = ${JSON.stringify(fingerprints.sourceVersion)};` +
        `export const SOURCE_VERSIONS = ${JSON.stringify(fingerprints.versions)};`;
    },
    name: "source-version",
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null)
  };
};
