import {
  BufferGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion,
  TorusGeometry, Vector3
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { catapultAmmoColor } from "../../../render-common/buildings/catapult-ammo-colors";
import { createCatapultRockGeometry, createCatapultRockMaterial, disposeCatapultRockMaterial } from "./catapult-rock-geometry";

const STONE_LAYOUT: readonly [number, number, number][] = [
  [0, .12, 0], [.28, .10, .16], [-.28, .10, .16], [.18, .10, -.26], [-.18, .10, -.26]
];
const STONE_SCALE = .34;
/** A pebble a third of a stone wide keeps its fractured silhouette at one subdivision less. */
const PEBBLE_SUBDIVISION = { detailed: 2, minimal: 1 } as const;
const CARRIED_DROP = -.18;

const mergeAt = (parts: readonly [BufferGeometry, Matrix4][]) => {
  const placed = parts.map(([geometry, matrix]) => geometry.clone().applyMatrix4(matrix));
  const merged = mergeGeometries(placed, false);
  placed.forEach(geometry => geometry.dispose());
  if (!merged) throw new Error("Catapult bundle geometry merge failed");
  return merged;
};

const buildRockGeometry = (detailed: boolean) => {
  const rock = createCatapultRockGeometry(detailed,
    detailed ? PEBBLE_SUBDIVISION.detailed : PEBBLE_SUBDIVISION.minimal);
  const merged = mergeAt(STONE_LAYOUT.map(([x, y, z]) =>
    [rock, new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeScale(STONE_SCALE, STONE_SCALE, STONE_SCALE))]));
  rock.dispose();
  return merged;
};

/** Strand thickness of the net, in unit-diameter space (the fisher's net uses the same thin cords). */
const NET_STRAND = .012;
const NET_CENTRE_Y = .11;
const NET_RADIUS = .5;
const NET_HEIGHT = .33;
const NET_BOTTOM_ANGLE = Math.PI * .64;
const NET_TOP_ANGLE = Math.PI * .05;
const UP = new Vector3(0, 1, 0);

/** Net node on the sagging shell: rings of latitude gather towards the tied top. */
const netPoint = (ring: number, rings: number, meridian: number, meridians: number) => {
  const angle = NET_TOP_ANGLE + (NET_BOTTOM_ANGLE - NET_TOP_ANGLE) * ring / rings;
  const around = (meridian / meridians) * Math.PI * 2 + ring * .18;
  const sag = 1 + .05 * Math.sin(meridian * 2.3 + ring);
  return new Vector3(
    Math.sin(angle) * Math.cos(around) * NET_RADIUS * sag,
    NET_CENTRE_Y + Math.cos(angle) * NET_HEIGHT,
    Math.sin(angle) * Math.sin(around) * NET_RADIUS * sag
  );
};

const strandMatrix = (from: Vector3, to: Vector3) => {
  const direction = to.clone().sub(from), length = direction.length();
  const matrix = new Matrix4().compose(from.clone().add(to).multiplyScalar(.5),
    new Quaternion().setFromUnitVectors(UP, direction.normalize()), new Vector3(1, length, 1));
  return matrix;
};

/**
 * Net like the fisher's: thin crossing strands, meridians gathered at the top, rings between them.
 * A strand is an open three-sided prism: at cord thickness it reads like a box at half the triangles.
 */
const buildNetGeometry = (detailed: boolean) => {
  const rings = detailed ? 6 : 3, meridians = detailed ? 10 : 6;
  const strand = new CylinderGeometry(NET_STRAND * .6, NET_STRAND * .6, 1, 3, 1, true);
  const parts: [BufferGeometry, Matrix4][] = [];
  for (let meridian = 0; meridian < meridians; meridian++)
    for (let ring = 0; ring < rings; ring++) {
      parts.push([strand, strandMatrix(netPoint(ring, rings, meridian, meridians),
        netPoint(ring + 1, rings, meridian, meridians))]);
      if (ring === 0) continue;
      parts.push([strand, strandMatrix(netPoint(ring, rings, meridian, meridians),
        netPoint(ring, rings, meridian + 1, meridians))]);
    }
  const gather = new CylinderGeometry(.045, .05, .06, 6);
  const loop = new TorusGeometry(.06, NET_STRAND * 1.4, 4, detailed ? 10 : 6);
  parts.push([gather, new Matrix4().makeTranslation(0, NET_CENTRE_Y + NET_HEIGHT + .01, 0)],
    [loop, new Matrix4().makeTranslation(0, NET_CENTRE_Y + NET_HEIGHT + .07, 0)]);
  const merged = mergeAt(parts);
  strand.dispose(); gather.dispose(); loop.dispose();
  return merged;
};

/**
 * Shared bundle kit: one merged granite-stone geometry and one merged rope geometry (two draw
 * calls per visible bundle), authored for a unit stone diameter and reused by every instance.
 */
export const createCatapultBundleKit = (detailed: boolean) => {
  const rockGeometry = buildRockGeometry(detailed), netGeometry = buildNetGeometry(detailed);
  const rockMaterial = createCatapultRockMaterial(detailed);
  const tint = catapultAmmoColor("granite");
  if (tint) rockMaterial.color.setRGB(tint[0]!, tint[1]!, tint[2]!);
  const netMaterial = new MeshStandardMaterial({ color: 0xa8845a, roughness: .95, metalness: 0 });
  const create = (localDiameter: number) => {
    const root = new Group(); root.name = "catapult_granite_bundle";
    const rocks = new Mesh(rockGeometry, rockMaterial), net = new Mesh(netGeometry, netMaterial);
    for (const mesh of [rocks, net]) {
      mesh.scale.setScalar(localDiameter); mesh.castShadow = detailed; mesh.receiveShadow = detailed;
      mesh.userData.catapultBundle = true; root.add(mesh);
    }
    root.userData.catapultBundle = true;
    return root;
  };
  const dispose = () => {
    rockGeometry.dispose(); netGeometry.dispose(); disposeCatapultRockMaterial(rockMaterial); netMaterial.dispose();
  };
  return { create, dispose };
};

/**
 * CAT-5 granite bundle for a carried prop: five small stones, two crossing rope loops and a knot.
 * The caller owns the returned root and calls userData.disposeOwnedMaterials when released.
 */
export const createCatapultGraniteBundle = (detailed: boolean, localDiameter: number) => {
  const kit = createCatapultBundleKit(detailed);
  const root = kit.create(localDiameter);
  // The bundle is authored as a compact carried prop; keep its physical centre on the stone origin.
  root.position.y = localDiameter * CARRIED_DROP;
  root.userData.disposeOwnedMaterials = kit.dispose;
  return root;
};

/** Local diameter of the carried bundle from the world stone diameter. */
export const bundleLocalDiameter = (worldDiameter: number, workerScale: number) => worldDiameter / workerScale;
