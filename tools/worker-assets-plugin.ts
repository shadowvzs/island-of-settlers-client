import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { Plugin } from "vite";

import { workerAssetFiles } from "./worker-asset-files.ts";

/** Content types of the worker game files the dev server hands out. */
const CONTENT_TYPES: Record<string, string> = {
  ".bin": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".js": "text/javascript",
  ".json": "application/json",
  ".ktx2": "image/ktx2",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".webp": "image/webp"
};
/** The Basis transcoder of the KTX2 worker textures, served as `workers/basis/`. */
const BASIS_FILES = ["basis_transcoder.js", "basis_transcoder.wasm"];

interface AssetFolders {
  /** The worker generator's `game_ready/`. */
  gameReady: string;
  /** three's `examples/jsm/libs/basis/`. */
  basis: string;
}

/** `/workers/basis/*` from three's transcoder folder, the rest from `game_ready/`. */
const resolveDevFile = (folders: AssetFolders, path: string) => {
  const [root, relative] = path.startsWith("/basis/")
    ? [folders.basis, path.slice("/basis".length)]
    : [folders.gameReady, path];
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
};

/** Dev server: `/workers/*` is served like the build lays it out. */
const serveWorkerAssets =
  (folders: AssetFolders): NonNullable<Plugin["configureServer"]> =>
  (server) => {
    server.middlewares.use("/workers", (request, response, next) => {
      const path = decodeURIComponent((request.url ?? "/").split("?")[0]!);
      const file = resolveDevFile(folders, path);
      if (!file) return next();
      response.setHeader(
        "Content-Type",
        CONTENT_TYPES[extname(file)] ?? "application/octet-stream"
      );
      createReadStream(file).pipe(response);
    });
  };

type Emit = (name: string, source: string | Uint8Array) => void;

/**
 * Ships the worker files the game uses, from the worker generator repository's `game_ready/`:
 * the owner's Tripo3D workers (Three.js bodies with KTX2 textures and their retargeted clips),
 * the props they hold and three's Basis transcoder; serves the same layout under `/workers/`
 * in dev.
 */
export const workerAssetsPlugin = (folders: AssetFolders): Plugin => ({
  configureServer: serveWorkerAssets(folders),
  name: "worker-game-assets",
  generateBundle() {
    const emit: Emit = (name, source) =>
      this.emitFile({ type: "asset", fileName: `workers/${name}`, source });
    for (const file of workerAssetFiles(folders.gameReady)) {
      const bytes = readFileSync(join(folders.gameReady, file));
      const source = /\.(?:json|gltf)$/.test(file)
        ? JSON.stringify(JSON.parse(bytes.toString("utf8"))) : bytes;
      emit(file, source);
    }
    for (const name of BASIS_FILES) emit(`basis/${name}`, readFileSync(join(folders.basis, name)));
  }
});

/** three's Basis transcoder folder next to the game's node_modules/three. */
export const basisFolder = (gameRoot: string) =>
  join(gameRoot, "node_modules/three/examples/jsm/libs/basis");
