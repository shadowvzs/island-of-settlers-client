import { registerHooks } from "node:module";

import { loadCatapultCpuPoser } from "./catapult-cpu-poser";

/** Exact production equipment geometry/placement/IK on CPU. Only atlas pixels are omitted:
 * material painting cannot affect any geometry, grip anchor or pose calculation. */
export const loadEquippedArmourCpu = async () => {
  const paint = registerHooks({ load(url, context, next) {
    const loaded = next(url, context);
    if (!url.endsWith("/renderers/three/military-equipment-atlas.ts")) return loaded;
    const source = (typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source!))
      .split("//# sourceMappingURL")[0]!;
    const compiled = /const paintEquipmentAtlas=__name\(size=>\{[\s\S]*?\},"paintEquipmentAtlas"\);/;
    if (compiled.test(source)) return { ...loaded,
      source: source.replace(compiled, "const paintEquipmentAtlas = size => new Uint8Array(size * size * 4);") };
    const signature = /export const paintEquipmentAtlas\s*=\s*\(size(?:: number)?\)\s*=>\s*\{[\s\S]*$/;
    if (!signature.test(source)) throw new Error("Cannot isolate CPU atlas painting without changing geometry atlas constants");
    return { ...loaded, source: source.replace(signature,
      "export const paintEquipmentAtlas = (size: number) => new Uint8Array(size * size * 4);") };
  } });
  let native: Awaited<ReturnType<typeof loadCatapultCpuPoser>> | undefined;
  try {
    native = await loadCatapultCpuPoser();
    const props = await import("../../src/renderers/three/three-worker-prop");
    const source = native;
    return { createWorkerPoser: native.createWorkerPoser, createWorkerProp: props.createWorkerProp,
      restore: () => { source.restore(); paint.deregister(); } };
  } catch (error) { native?.restore(); paint.deregister(); throw error; }
};
