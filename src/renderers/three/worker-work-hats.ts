import { WORKER_HEADWEAR_STYLE as STYLE } from "@workers/worker-headwear-style";
import {
  type BufferGeometry, ConeGeometry, CylinderGeometry, DataTexture, DoubleSide, Group, LinearMipmapLinearFilter,
  Mesh, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SphereGeometry, SRGBColorSpace, TorusGeometry
} from "three";

import type { WorkerNation } from "../../render-common/workers/worker-unit";

/** Shared fine cloth weave; geometry supplies the actual rolled rims, folded wraps and straw ribs. */
const clothWeave = () => {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const thread = (x % 4 === 0 ? -15 : 0) + (z % 4 === 0 ? -10 : 0) + ((x + z) % 7 === 0 ? 5 : 0);
    const at = (z * size + x) * 4;
    pixels[at] = pixels[at + 1] = pixels[at + 2] = 240 + thread; pixels[at + 3] = 255;
  }
  const map = new DataTexture(pixels, size, size, RGBAFormat);
  map.colorSpace = SRGBColorSpace; map.wrapS = map.wrapT = RepeatWrapping;
  map.repeat.set(3, 2); map.generateMipmaps = true; map.minFilter = LinearMipmapLinearFilter; map.needsUpdate = true;
  return map;
};
interface HatTemplate { geometry: BufferGeometry; color: number | string }
/** Shared civilian work hats; the underlying face/hair/body are the actual population GLBs. */
export const createWorkerWorkHats = (detailed: boolean) => {
  const map = clothWeave(), templates = new Map<WorkerNation, HatTemplate[]>();
  const parts = (nation: WorkerNation) => {
    const found = templates.get(nation); if (found) return found;
    const pieces: HatTemplate[] = [];
    const add = (geometry: BufferGeometry, color: number | string) => { pieces.push({ color, geometry }); };
    const ring = (radius: number, y: number, thickness: number, color: number | string) => {
      const geometry = new TorusGeometry(radius, thickness, detailed ? 7 : 4, detailed ? 40 : 16);
      geometry.rotateX(Math.PI / 2); geometry.translate(0, y, 0); add(geometry, color);
    };
    if (nation === "japanese") {
      const straw = new ConeGeometry(.225, .145, detailed ? 48 : 20, detailed ? 4 : 1, true);
      straw.translate(0, .154, 0); add(straw, STYLE.kasa.color);
      ring(.222, .082, .006, STYLE.kasa.edge);
      for (let index = 1; index < (detailed ? 7 : 3); index++) {
        const t = index / (detailed ? 7 : 3);
        ring(.225 * t, .227 - .145 * t, .0025, index % 2 ? STYLE.kasa.light : STYLE.kasa.rib);
      }
      const band = new CylinderGeometry(.113, .116, .025, detailed ? 32 : 14, 1, true);
      band.translate(0, .081, 0); add(band, 0x51442b);
    } else {
      const cap = new SphereGeometry(.119, detailed ? 32 : 16, detailed ? 16 : 8, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, nation === "viking" ? .86 : 1.04, 1.08); cap.translate(0, .075, 0);
      const style = { nubian: STYLE.headcloth, viking: STYLE.woolCap, roman: STYLE.pileus, indigenous: STYLE.pileus, chinese: STYLE.pileus, persian: STYLE.pileus, maya: STYLE.pileus }[nation];
      add(cap, style.color);
      if (nation === "nubian") {
        for (let index = 0; index < (detailed ? 6 : 3); index++) {
          const wrap = new TorusGeometry(.113 - index * .002, .013, detailed ? 8 : 4, detailed ? 44 : 18);
          wrap.scale(1, .7, 1.08); wrap.rotateX(Math.PI / 2); wrap.rotateZ(index % 2 ? .075 : -.075);
          wrap.translate(0, .078 + index * .014, 0); add(wrap, index % 2 ? 0xd3c5a2 : 0xeee4cc);
        }
        const tail = new CylinderGeometry(.018, .013, .115, detailed ? 8 : 4);
        tail.scale(.45, 1, 1); tail.rotateX(-.2); tail.translate(0, .045, -.12); add(tail, 0xe5d9bb);
      } else {
        ring(.113, .079, .012, nation === "viking" ? STYLE.woolCap.edge : STYLE.pileus.edge);
        if (detailed) {
          // Small stitched panels follow the crown; these are raised threads, not painted stripes.
          for (let seam = 0; seam < 4; seam++) {
            const thread = new TorusGeometry(.12, .0018, 4, 22, Math.PI);
            thread.rotateY(seam * Math.PI / 2); thread.scale(1, nation === "viking" ? .86 : 1.04, 1.08);
            thread.translate(0, .075, 0); add(thread, nation === "viking" ? 0xc3baa1 : 0xc6a989);
          }
        }
      }
    }
    templates.set(nation, pieces); return pieces;
  };
  return {
    create: (nation: WorkerNation) => {
      const root = new Group(); root.name = `canonical_boat_work_hat_${nation}`;
      const materials = parts(nation).map(part => new MeshStandardMaterial({ color: part.color, map,
        bumpMap: map, bumpScale: .0015, roughness: .97, side: DoubleSide }));
      parts(nation).forEach((part, index) => root.add(new Mesh(part.geometry, materials[index])));
      const fit = { chinese: .82, persian: .82, maya: .82, indigenous: .82, roman: .82, nubian: .92, japanese: .95, viking: 1 }[nation];
      root.scale.set(fit, fit, nation === "japanese" ? fit * 1.12 : fit);
      return { root, dispose: () => { root.removeFromParent(); materials.forEach(material => material.dispose()); } };
    },
    dispose: () => { templates.forEach(items => items.forEach(item => item.geometry.dispose())); templates.clear(); map.dispose(); }
  };
};
