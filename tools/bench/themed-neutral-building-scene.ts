import * as three from "three";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import {
  type EnemyBuildingStyle,
  enemyBuildingStyleKey} from "../../src/render-common/buildings/themed-neutral-building-style";
import { createNeutralBuilding } from "../../src/renderers/three/buildings/neutral-building";
import { createNeutralBuildingMaterials } from "../../src/renderers/three/buildings/neutral-building-materials";
import { createRomanMaterials } from "../../src/renderers/three/buildings/roman-materials";
import { createThemedNeutralBuildingMaterials } from "../../src/renderers/three/buildings/themed-neutral-building-materials";

export const themedNeutralBuildingScene = (detailed: boolean) => {
  const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(1);
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = detailed;
  document.body.style.margin = "0";
  document.body.append(renderer.domElement);
  const scene = new three.Scene();
  scene.background = new three.Color("#c6c9b9");
  scene.add(new three.HemisphereLight("#fff1d4", "#64744d", 2.4));
  const sun = new three.DirectionalLight("#fff1dc", 3.2);
  sun.position.set(-3, 7, 5);
  sun.castShadow = detailed;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  const ground = new three.Mesh(
    new three.PlaneGeometry(30, 30),
    new three.MeshStandardMaterial({ color: 0x86916f, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.018;
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = new three.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 60);
  const roman = createRomanMaterials(detailed),
    neutral = createNeutralBuildingMaterials(roman.materials);
  const packs = new Map<string, ReturnType<typeof createThemedNeutralBuildingMaterials>>();
  let model: ReturnType<typeof createNeutralBuilding> | undefined;
  return {
    shot: (id: number, style: EnemyBuildingStyle, view: string) => {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      model?.root.removeFromParent();
      model?.dispose();
      const key = enemyBuildingStyleKey(style);
      let pack = packs.get(key);
      if (!pack) {
        pack = createThemedNeutralBuildingMaterials(neutral.materials, style, true);
        packs.set(key, pack);
      }
      model = createNeutralBuilding(getBuildingDefinition(id), pack.materials, detailed, style);
      model.update(0.4, {
        construction: 1,
        door: 1,
        working: false,
        playerColor: [0.75, 0.12, 0.07]
      });
      scene.add(model.root);
      ground.material.color.setHex(
        {
          forest: 0x86916f,
          tropical: 0xa3a87a,
          winter: 0xd4d8d4,
          desert: 0xc4ac80,
          swamp: 0x737f66
        }[style.theme]
      );
      const bounds = new three.Box3().setFromObject(model.root),
        center = bounds.getCenter(new three.Vector3()),
        size = bounds.getSize(new three.Vector3());
      const yaw =
        {
          front: 0,
          rear: Math.PI,
          side: Math.PI / 2,
          threeQuarter: Math.PI / 4,
          gameplay: Math.PI / 4
        }[view as "front"] ?? 0;
      const distance = Math.max(size.x, size.y, size.z) * 2.2 * (view === "gameplay" ? 1.65 : 1);
      camera.position.set(
        center.x + Math.sin(yaw) * distance,
        center.y + distance * 0.48,
        center.z + Math.cos(yaw) * distance
      );
      camera.lookAt(center);
      renderer.render(scene, camera);
      return {
        id,
        style: key,
        triangles: model.triangles(false),
        drawCalls: renderer.info.render.calls,
        materials: packs.size,
        stock: model.root.children.filter((object) => object.name.includes("stock")).length
      };
    },
    exportCurrent: async () => {
      if (!model) throw new Error("Select a camp before exporting");
      const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
      const bytes = await new GLTFExporter().parseAsync(model.root, {
        binary: true,
        onlyVisible: false,
        animations: model.root.animations
      });
      if (!(bytes instanceof ArrayBuffer)) throw new Error("Expected binary camp model");
      return new Promise<string>((done, reject) => {
        const reader = new FileReader();
        reader.onload = () => done((reader.result as string).split(",")[1]!);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([bytes]));
      });
    },
    dispose: () => {
      model?.dispose();
      for (const pack of packs.values()) pack.dispose();
      neutral.dispose();
      roman.dispose();
      renderer.dispose();
    }
  };
};
