import { createHash } from "node:crypto";

import { type BufferGeometry, InstancedMesh, type Material, Mesh, type Object3D, OrthographicCamera } from "three";
import { describe, expect, it } from "vitest";

import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createThreeFishingBoats } from "../src/renderers/three/settlement/three-fishing-boats";
import { createThreeHarbourShuttles } from "../src/renderers/three/settlement/three-harbour-shuttles";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import { createThreeWhales } from "../src/renderers/three/three-whales";
import type { WorldData } from "../src/shared/world/world-data";

/**
 * CAT9b parity: the scene graph (geometry bytes, transforms, visibility and material parameters) that ships, boats
 * and whales draw. Identical graphs render identical pixels; the snapshot was recorded before the registry routing.
 */
const hashGeometry = (hash: ReturnType<typeof createHash>, geometry: BufferGeometry) => {
  for (const [name, attribute] of Object.entries(geometry.attributes).sort(([first], [second]) =>
    first.localeCompare(second))) {
    hash.update(name);
    hash.update(new Uint8Array((attribute.array as Float32Array).buffer.slice(0)));
  }
  if (geometry.index) hash.update(new Uint8Array((geometry.index.array as Uint16Array).buffer.slice(0)));
  hash.update(`${geometry.drawRange.start}:${geometry.drawRange.count}`);
};

const MATERIAL_FIELDS = [
  "type", "name", "color", "emissive", "roughness", "metalness", "opacity", "transparent", "side", "vertexColors",
  "flatShading", "depthWrite"
] as const;

const hashMaterial = (hash: ReturnType<typeof createHash>, material: Material) => {
  const fields = material as unknown as Record<string, unknown>;
  for (const field of MATERIAL_FIELDS) {
    const value = fields[field] as { getHexString?: () => string } | undefined;
    hash.update(`${field}=${value?.getHexString ? value.getHexString() : String(value)};`);
  }
};

const hashScene = (root: Object3D) => {
  const hash = createHash("sha256");
  root.updateMatrixWorld(true);
  root.traverse(node => {
    hash.update(`${node.name}|${node.visible}|${node.matrixWorld.elements.join(",")}`);
    if (!(node instanceof Mesh)) return;
    hashGeometry(hash, node.geometry);
    for (const material of [node.material].flat()) hashMaterial(hash, material);
    if (node instanceof InstancedMesh) {
      hash.update(`${node.count}`);
      hash.update(new Uint8Array(node.instanceMatrix.array.buffer.slice(0)));
    }
  });
  return hash.digest("hex").slice(0, 16);
};

const ship: ShipFrame = { cargoCount: 0, id: 1, phase: "idle", x: 0, y: 0, yaw: -.3, z: 0 };

const shipHash = (quality: "high" | "minimal", nation: WorkerNation, frame: Partial<ShipFrame> = {}) => {
  const layer = createThreeSettlementShips(quality);
  layer.update([{ ...ship, ...frame }], [], 0, { playerNation: nation });
  const hash = hashScene(layer.group);
  layer.dispose();
  return hash;
};

const skiffHash = (detailed: boolean, nation: WorkerNation) => {
  const layer = createThreeFishingBoats(detailed);
  layer.update([{ crewed: false, id: 3, nation, person: 0, rowing: false, x: 1, y: 0, yaw: .4, z: 2 }], 1);
  const hash = hashScene(layer.group);
  layer.dispose();
  return hash;
};

const lighterHash = (detailed: boolean, nation: WorkerNation) => {
  const layer = createThreeHarbourShuttles(detailed);
  layer.update([{ boxes: 2, id: 1, laden: true, nation, rowing: true, x: 2, y: -1, yaw: .4, z: 3 }], 1.5);
  const hash = hashScene(layer.group);
  layer.dispose();
  return hash;
};

const SEA = 96;
const sea = () => ({
  cellsX: SEA, cellsZ: SEA, seaLevel: 0, seed: 7,
  waterDepth: new Float32Array((SEA + 1) * (SEA + 1)).fill(30),
  waterSurface: new Float32Array((SEA + 1) * (SEA + 1))
}) as unknown as WorldData;

/** The body mesh of a surfacing `species` whale (0 humpback, 1 orca) at the preset's detail. */
const whaleHash = (level: "full" | "lite", species: 0 | 1) => {
  const whales = createThreeWhales({}, sea(), { level, sunShadows: false });
  const camera = new OrthographicCamera(-40, 40, 40, -40, .1, 400);
  camera.position.set(48, 60, 48); camera.lookAt(48, 0, 48);
  whales.debug.trigger("breach", species, { x: 48, z: 48, yaw: 0 });
  whales.update(1, camera, false, 8000, 0, 0);
  return hashScene(whales.meshes[0]!);
};

describe("ship, boat and whale model parity (CAT9b registry routing)", () => {
  it("draws the same ship scene graphs", () => {
    expect({
      neutralPersianHigh: shipHash("high", "roman", { livery: "neutral", nation: "persian" }),
      raiderHigh: shipHash("high", "roman", { livery: "enemy" }),
      romanHigh: shipHash("high", "roman"),
      vikingMinimal: shipHash("minimal", "viking")
    }).toMatchSnapshot();
  });

  it("draws the same fishing skiff and lighter scene graphs", () => {
    expect({
      lighterJapaneseHigh: lighterHash(true, "japanese"),
      lighterMayaMinimal: lighterHash(false, "maya"),
      skiffNubianMinimal: skiffHash(false, "nubian"),
      skiffRomanHigh: skiffHash(true, "roman")
    }).toMatchSnapshot();
  });

  it("draws the same whale bodies", () => {
    expect({
      humpbackFull: whaleHash("full", 0),
      orcaFull: whaleHash("full", 1),
      orcaLite: whaleHash("lite", 1)
    }).toMatchSnapshot();
  });
});
