import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectBackend } from "../src/app/backend/backend-status";
import { loadPublishedStarterMap } from "../src/app/map-editor/map-catalog";
import { openMapStorage, PUBLISHED_MAP_PREFIX, type MapStorage } from "../src/app/map-editor/map-storage";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { cachedWorld } from "./helpers/cached-worlds";

vi.mock("../src/app/backend/backend-status", () => ({ detectBackend: vi.fn() }));
vi.mock("../src/app/map-editor/map-storage", async () => {
  const actual = await vi.importActual<typeof import("../src/app/map-editor/map-storage")>(
    "../src/app/map-editor/map-storage"
  );
  return { ...actual, openMapStorage: vi.fn() };
});

const backend = { apiUrl: "https://api.test", identityUrl: "https://identity.test" };
const mapId = "2f1e7d42-9b0a-4c74-8f36-3f7aae3d9c11";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json" } });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const storage = () => ({
  close: vi.fn(),
  delete: vi.fn(async () => undefined),
  list: vi.fn(async () => []),
  read: vi.fn(async () => null),
  write: vi.fn(async () => undefined)
}) as unknown as MapStorage & { delete: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn> };

const fixture = async () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 0,
    forest: 0, mountains: 0, rivers: 0 });
  const bytes = await writeMapFile(world, { animals: [], name: "Catalog island", savedAt: 123,
    source: "generated" });
  return { bytes, hash: hash(bytes) };
};

const metadata = (bytes: Uint8Array, revision = 1) => ({
  bytesUrl: "/v1/maps/starter/bytes",
  hash: hash(bytes),
  mapId,
  metadata: { name: "Catalog island", savedAt: 123, source: "generated" },
  revision,
  size: bytes.length
});

beforeEach(() => {
  vi.mocked(detectBackend).mockResolvedValue(backend);
  vi.mocked(openMapStorage).mockResolvedValue(storage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("published starter catalog cache and failure handling", () => {
  it("loads the exact cached revision without downloading the bytes again", async () => {
    const { bytes } = await fixture();
    const mapStorage = storage();
    mapStorage.read.mockResolvedValue(bytes);
    vi.mocked(openMapStorage).mockResolvedValue(mapStorage);
    const fetchMock = vi.fn(async () => json(metadata(bytes)));
    vi.stubGlobal("fetch", fetchMock);
    const loaded = await loadPublishedStarterMap();
    expect(loaded?.loaded?.meta.name).toBe("Catalog island");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mapStorage.write).not.toHaveBeenCalled();
  });

  it("discards a corrupt cached map and refetches the exact hash", async () => {
    const { bytes } = await fixture();
    const mapStorage = storage();
    mapStorage.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(openMapStorage).mockResolvedValue(mapStorage);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/maps/starter")) return json(metadata(bytes));
      if (String(input).endsWith("/v1/maps/starter/bytes"))
        return new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const loaded = await loadPublishedStarterMap();
    expect(loaded?.loaded?.meta.name).toBe("Catalog island");
    expect(mapStorage.delete).toHaveBeenCalledWith(`${PUBLISHED_MAP_PREFIX}${hash(bytes)}`);
    expect(mapStorage.write).toHaveBeenCalled();
  });

  it("does not silently use a missing or damaged catalog and does not cache a failed download", async () => {
    const { bytes } = await fixture();
    const mapStorage = storage();
    vi.mocked(openMapStorage).mockResolvedValue(mapStorage);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/maps/starter")) return json(metadata(bytes));
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadPublishedStarterMap()).toBeNull();
    expect(mapStorage.write).not.toHaveBeenCalled();
  });

  it("treats an unpublished catalog as absent without requesting bytes", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadPublishedStarterMap()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null without a configured backend", async () => {
    vi.mocked(detectBackend).mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadPublishedStarterMap()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
