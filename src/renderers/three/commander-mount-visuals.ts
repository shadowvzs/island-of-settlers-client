import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry
} from "three";

import {
  COMMANDER_AURA_RADIUS_TILES, type CommanderAppearance
} from "../../render-common/mounts/commander-appearance";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";

export interface CommanderInsignia {
  dispose: () => void;
  group: Group;
}

/** A national standard on the rider's back, with a small nation-specific command trophy. */
export const createCommanderInsignia = (
  appearance: CommanderAppearance, detailed: boolean
): CommanderInsignia => {
  const group = new Group();
  group.name = "commander_insignia";
  const cloth = new MeshStandardMaterial({ color: appearance.bannerColor, roughness: .82, side: DoubleSide });
  const trim = new MeshStandardMaterial({ color: appearance.emblemColor, metalness: .55, roughness: .42 });
  const leather = new MeshStandardMaterial({ color: 0x4a3521, roughness: .9 });
  const materials = [cloth, trim, leather];
  const geometries: BufferGeometry[] = [];
  const mesh = (geometry: BufferGeometry, material: MeshStandardMaterial,
    position: [number, number, number], rotation?: [number, number, number]) => {
    geometries.push(geometry);
    const part = new Mesh(geometry, material);
    part.position.set(...position);
    if (rotation) part.rotation.set(...rotation);
    group.add(part);
  };
  const sashimono = appearance.insignia === "sashimono";
  const poleTop = sashimono ? .82 : .78;
  mesh(new CylinderGeometry(.012, .012, poleTop - .18, 5), leather, [0, (poleTop + .18) / 2, -.16]);
  mesh(new BoxGeometry(sashimono ? .2 : .28, .018, .018), leather, [0, poleTop, -.16]);
  const width = sashimono ? .13 : .24, height = sashimono ? .34 : .24;
  mesh(new PlaneGeometry(width, height), cloth, [0, poleTop - height / 2 - .012, -.162]);
  mesh(new PlaneGeometry(width + .012, .025), trim, [0, poleTop - height - .018, -.163]);
  if (detailed) mesh(new PlaneGeometry(width + .01, .014), trim, [0, poleTop - .022, -.163]);
  if (appearance.insignia === "shield" || appearance.insignia === "standard") {
    mesh(new CylinderGeometry(.16, .16, .028, 14), cloth, [0, .22, -.16], [Math.PI / 2, 0, 0]);
    mesh(new CylinderGeometry(.05, .05, .018, 10), trim, [0, .22, -.176], [Math.PI / 2, 0, 0]);
  }
  if (appearance.insignia === "bow") {
    mesh(new CylinderGeometry(.025, .025, .5, 6), leather, [-.14, .22, -.17], [0, 0, -.35]);
    mesh(new CylinderGeometry(.05, .045, .18, 7), leather, [.13, .1, -.17], [0, 0, .25]);
    for (const offset of [-.032, 0, .032])
      mesh(new CylinderGeometry(.006, .006, .22, 4), trim, [.13 + offset, .24, -.17]);
  }
  return {
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.removeFromParent();
    },
    group
  };
};

export interface CommanderAura {
  dispose: () => void;
  group: Group;
}

/** Soft six-tile ground aura: shared radius visual, cheap enough for Minimal. */
export const createCommanderAura = (appearance: CommanderAppearance, detailed: boolean): CommanderAura => {
  const radius = COMMANDER_AURA_RADIUS_TILES / WORKER_SCALE;
  const group = new Group();
  group.name = "commander_aura";
  const materials: MeshBasicMaterial[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.55)");
  gradient.addColorStop(.55, "rgba(255,255,255,0.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  const discMaterial = new MeshBasicMaterial({ color: appearance.auraColor, map: texture, opacity: .3,
    transparent: true, depthWrite: false, side: DoubleSide });
  const disc = new Mesh(new CircleGeometry(radius, detailed ? 48 : 24), discMaterial);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = .008 / WORKER_SCALE;
  materials.push(discMaterial);
  group.add(disc);
  const ringMaterial = new MeshBasicMaterial({ color: appearance.auraColor, opacity: .55, transparent: true,
    depthWrite: false, blending: AdditiveBlending });
  const ring = new Mesh(new RingGeometry(radius - .12 / WORKER_SCALE, radius, detailed ? 64 : 32), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .01 / WORKER_SCALE;
  materials.push(ringMaterial);
  group.add(ring);
  if (detailed) {
    const innerMaterial = new MeshBasicMaterial({ color: appearance.auraColor, opacity: .22, transparent: true,
      depthWrite: false });
    const inner = new Mesh(new RingGeometry(radius * .55, radius * .55 + .045 / WORKER_SCALE, 48), innerMaterial);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = .009 / WORKER_SCALE;
    materials.push(innerMaterial);
    group.add(inner);
  }
  return {
    dispose: () => {
      disc.geometry.dispose();
      ring.geometry.dispose();
      texture.dispose();
      for (const material of materials) material.dispose();
      group.removeFromParent();
    },
    group
  };
};
