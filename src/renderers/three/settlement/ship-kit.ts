import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Group, Mesh, TorusGeometry, TubeGeometry, Vector3
} from "three";

import type { ShipMaterialName, ShipMaterials } from "./ship-materials";

type ShipPoint = readonly number[];

/**
 * Building blocks of a hull or rig recipe, in ship space before the sailing-ship scale. Every piece is
 * built once per hull style and merged into that style's static material batches, so the
 * temporary geometries (`temp`) are freed after the merge; shared primitives stay owned.
 */
export interface ShipKit {
  detailed: boolean;
  materials: ShipMaterials;
  /** Unit primitives shared by every style. */
  box: BufferGeometry; coinRing: BufferGeometry; medallion: BufferGeometry; pole: BufferGeometry;
  /** A box (unit cube scaled to `dimensions`) at `position`. */
  add: (parent: Group, material: ShipMaterialName, dimensions: ShipPoint, position: ShipPoint) => Mesh;
  /** A mesh of a one-off geometry (freed once merged). */
  mesh: (parent: Group, material: ShipMaterialName, geometry: BufferGeometry) => Mesh;
  /** Registers a one-off geometry, freed once the style's batches are merged. */
  temp: <T extends BufferGeometry>(geometry: T) => T;
  /** A rope or rail tube through `points`. */
  curve: (parent: Group, material: ShipMaterialName, points: readonly ShipPoint[], radius: number,
    segments?: number) => Mesh;
}

export const createShipKit = (detailed: boolean, materials: ShipMaterials,
  own: <T extends BufferGeometry>(geometry: T) => T, temp: <T extends BufferGeometry>(geometry: T) => T): ShipKit => {
  const box = own(new BoxGeometry(1, 1, 1)), pole = own(new CylinderGeometry(1, 1, 1, detailed ? 8 : 5));
  const medallion = own(new CylinderGeometry(1, 1, 1, detailed ? 12 : 6));
  const coinRing = own(new TorusGeometry(1, .10, 3, 12));
  const mesh = (parent: Group, material: ShipMaterialName, geometry: BufferGeometry) => {
    const result = new Mesh(geometry, materials[material]); result.castShadow = true; parent.add(result);
    return result;
  };
  const add = (parent: Group, material: ShipMaterialName, dimensions: ShipPoint, position: ShipPoint) => {
    const result = mesh(parent, material, box);
    result.scale.set(dimensions[0]!, dimensions[1]!, dimensions[2]!);
    result.position.set(position[0]!, position[1]!, position[2]!);
    return result;
  };
  const curve = (parent: Group, material: ShipMaterialName, points: readonly ShipPoint[], radius: number,
    segments = detailed ? 12 : 6) => {
    const path = new CatmullRomCurve3(points.map(point => new Vector3(point[0]!, point[1]!, point[2]!)));
    return mesh(parent, material, temp(new TubeGeometry(path, segments, radius, detailed ? 6 : 3)));
  };
  return { add, box, coinRing, curve, detailed, materials, medallion, mesh, pole, temp };
};
