import { type Texture, TextureLoader } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

import { withBuildingExportNormalMaps } from "./building-export-normal-maps";
import { verifyBuildingLibraryReload } from "./building-export-reload-fixture";

export const diagnoseBuildingImageExport = async (operation: () => Promise<ArrayBuffer>, expectedClips: string[]) => {
  const load = TextureLoader.prototype.load, parse = GLTFExporter.prototype.parseAsync;
  const records: { url: string; texture?: Texture; state: string; disposed: boolean;
    loadedImage: string | null; callbackClearedImage: boolean }[] = [];
  const pending: Promise<void>[] = [];
  let atParse: unknown[] = [];
  TextureLoader.prototype.load = function (...args: Parameters<typeof load>) {
    const [url, onLoad, onProgress, onError] = args;
    const record = { url, texture: undefined as Texture | undefined, state: "pending", disposed: false,
      loadedImage: null as string | null, callbackClearedImage: false };
    let settled!: () => void;
    pending.push(new Promise<void>(resolve => { settled = resolve; })); records.push(record);
    const texture = load.call(this, url, loaded => {
      record.state = "loaded"; record.loadedImage = loaded.image?.constructor?.name ?? null;
      onLoad?.(loaded); record.callbackClearedImage = loaded.image === null; settled();
    }, onProgress, error => { record.state = "error"; onError?.(error); settled(); });
    record.texture = texture; texture.addEventListener("dispose", () => { record.disposed = true; });
    return texture;
  };
  GLTFExporter.prototype.parseAsync = function (...args: Parameters<typeof parse>) {
    atParse = records.map(({ texture, ...record }) => ({ ...record, texture: texture?.uuid,
      image: texture?.image?.constructor?.name ?? null }));
    return parse.apply(this, args);
  };
  let result: { failed: boolean; reproducedNullImageFailure: boolean; error?: string; bytes?: number;
    animationProof?: unknown };
  try {
    try {
      const bytes = await withBuildingExportNormalMaps(operation);
      const length = new DataView(bytes).getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
      const names = json.animations.map((clip: { name: string }) => clip.name).sort();
      if (JSON.stringify(names) !== JSON.stringify([...expectedClips].sort()))
        throw new Error("Native/exported animation clip names or counts changed");
      const unbound: { clip: string; channel: number }[] = [];
      for (const clip of json.animations) clip.channels.forEach((channel: { target: { node?: number } }, index: number) => {
        if (!Number.isInteger(channel.target.node) || !json.nodes[channel.target.node!])
          unbound.push({ clip: clip.name, channel: index });
      });
      const fishery = json.animations.find((clip: { name: string }) => clip.name === "indigenous_18_door");
      const fisheryNode = json.nodes[fishery.channels[0].target.node];
      if (fishery.channels.length !== 1 || fisheryNode?.name !== "indigenous_18_door" || fisheryNode.mesh !== undefined)
        throw new Error("Hidden Fishery door no-op is not bound to its real empty export anchor");
      if (unbound.length) throw new Error(`Unbound exported animation channels: ${JSON.stringify(unbound)}`);
      const officialReload = await verifyBuildingLibraryReload(bytes, expectedClips);
      result = { failed: false, reproducedNullImageFailure: false, bytes: bytes.byteLength,
        animationProof: { count: names.length, sameNativeNames: true, hiddenFisheryAnchor: fisheryNode.name,
          hiddenFisheryHasMesh: false, allChannelsBound: unbound.length === 0, unbound, officialReload } };
    } catch (error) { result = { failed: true,
      reproducedNullImageFailure: String(error).includes("No valid image data found"), error: String(error) }; }
    await Promise.all(pending);
    return { ...result, atParse, afterActualLoads: records.map(({ texture, ...record }) =>
      ({ ...record, texture: texture?.uuid, finalImage: texture?.image?.constructor?.name ?? null })) };
  } finally { TextureLoader.prototype.load = load; GLTFExporter.prototype.parseAsync = parse; }
};
