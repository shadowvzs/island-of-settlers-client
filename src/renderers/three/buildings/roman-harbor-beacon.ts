import {
  CylinderGeometry, Group, Mesh, MeshBasicMaterial,   type MeshStandardMaterial,
SphereGeometry, VectorKeyframeTrack} from "three";

import type { BuildingSurface, Point3 } from "../../../render-common/buildings/building-recipe";
import { ROMAN_HARBOR_BEACON_POSITION } from "../../../render-common/buildings/roman-harbor";

const beaconPulse = (time: number) => .94 + Math.sin(time * 3.4) * .04 + Math.sin(time * 7.1) * .02;

/** A guarded warm shore light. Both LODs animate; no island-wide dynamic light or long beam. */
export const createRomanHarborBeacon = (
  id: number, materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean,
  position: Readonly<Point3> = ROMAN_HARBOR_BEACON_POSITION, warmMetal = false
) => {
  if (id !== 39) return undefined;
  const root = new Group(); root.name = "harbor_shore_beacon";
  root.position.set(...position);
  let baseMaterial = materials.iron;
  if (warmMetal) {
    baseMaterial = materials.iron.clone();
    baseMaterial.color.setHex(0x8b704b);
    // Iron's dark albedo hides the bronze tint, especially under a roof without an environment map.
    baseMaterial.map = null;
    // This raw cylinder has no vertex-color attribute (unlike merged building parts).
    baseMaterial.vertexColors = false;
    baseMaterial.metalness = .2; baseMaterial.roughness = .66;
    baseMaterial.name = "roman-beacon-weathered-bronze";
  }
  const base = new Mesh(new CylinderGeometry(.065, .105, .15, detailed ? 12 : 6), baseMaterial);
  base.name = "harbor_beacon_brazier";
  base.userData.ownedMaterial = warmMetal;
  base.position.y = -.145;
  root.add(base);
  const lamp = new Group(); lamp.name = "harbor_beacon_lamp";
  const material = new MeshBasicMaterial({ color: 0xffcd78, toneMapped: false });
  const lens = new Mesh(new SphereGeometry(1, detailed ? 10 : 6, detailed ? 6 : 3), material);
  lens.scale.set(.06, .115, .06);
  lens.userData.ownedMaterial = true;
  lamp.add(lens);
  if (detailed) {
    const haloMaterial = new MeshBasicMaterial({ color: 0xffbe58, transparent: true,
      opacity: .13, depthWrite: false, toneMapped: false });
    const halo = new Mesh(new SphereGeometry(1, 8, 4), haloMaterial);
    halo.scale.set(.14, .17, .14);
    halo.userData.ownedMaterial = true;
    lamp.add(halo);
  }
  root.add(lamp);
  const times = Array.from({ length: 41 }, (_, index) => index / 20);
  const tracks = [new VectorKeyframeTrack(`${lamp.name}.scale`, times,
    times.flatMap(time => { const scale = beaconPulse(time); return [scale, scale, scale]; }))];
  return {
    root, tracks,
    update: (time: number, completed: boolean) => {
      root.visible = completed;
      lamp.scale.setScalar(beaconPulse(time));
    }
  };
};
