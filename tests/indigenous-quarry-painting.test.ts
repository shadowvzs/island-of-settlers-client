import { Box3, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { indigenousBuildingMotif } from "../src/render-common/buildings/indigenous-building-motifs";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { indigenousCaveMineral } from "../src/renderers/three/buildings/indigenous-cave-art-minerals";
import { indigenousCaveScene } from "../src/renderers/three/buildings/indigenous-cave-art-scenes";
import { createIndigenousPigmentStoneSurface } from "../src/renderers/three/buildings/indigenous-pigment-stone-surface";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const quarryIds = [19, 43, 47, 51, 55];

it.each([true, false])("inherits the actual stone lighting without moving projected ink (%s)", detailed => {
  const material = new MeshBasicMaterial();
  try {
    for (const level of [1, 5] as const) {
      const recipe = leveledBuildingRecipe(getBuildingDefinition(19), "indigenous", detailed, level);
      const part = recipe.parts.find(part => part.indigenousPigment)!;
      const paint = new Mesh(createRomanPartGeometry(part, detailed), material);
      const walls = recipe.parts.filter(candidate => candidate.architecture &&
        (candidate.indigenousMasonryStone || candidate.surface === "indigenous-rubble"))
        .map(candidate => new Mesh(createRomanPartGeometry(candidate, detailed), material));
      for (const mesh of [paint, ...walls]) mesh.updateMatrixWorld(true);
      try {
        for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
          const x = part.position[0] + ((column + .5) / 8 - .5) * part.size[0];
          const y = part.position[1] + ((row + .5) / 8 - .5) * part.size[1];
          const ray = new Raycaster(new Vector3(x, y, 3), new Vector3(0, 0, -1));
          const ink = ray.intersectObject(paint)[0], stone = ray.intersectObjects(walls)[0];
          expect(ink).toBeDefined(); expect(stone).toBeDefined();
          expect(ink!.point.z - stone!.point.z).toBeCloseTo(.0008, 5);
          expect(ink!.normal!.normalize().dot(stone!.normal!.normalize())).toBeGreaterThan(.995);
        }
      } finally { for (const mesh of [paint, ...walls]) mesh.geometry.dispose(); }
    }
  } finally { material.dispose(); }
});

it.each([true, false])("places larger resource-specific paint above stock on actual stock-side stones (%s)", detailed => {
  for (const id of quarryIds) for (const level of [1, 2, 3, 4, 5] as const) {
    const recipe = leveledBuildingRecipe(getBuildingDefinition(id), "indigenous", detailed, level);
    const paint = recipe.parts.filter(part => part.indigenousPigment);
    expect(paint.length).toBe(1);
    expect(paint[0]!.indigenousPigment).toBe(indigenousBuildingMotif(id));
    expect(paint[0]!.indigenousPigmentCarriers!.some(carrier => carrier.masonry)).toBe(true);
    const geometry = createRomanPartGeometry(paint[0]!, detailed);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    expect(bounds.max.x).toBeLessThan(recipe.door[0] - .08);
    expect(bounds.getSize(new Vector3()).x).toBeGreaterThan(.60);
    expect(bounds.getSize(new Vector3()).x * bounds.getSize(new Vector3()).y).toBeGreaterThan(.23 * .27 * 2.5);
    const stockTop = Math.max(...recipe.parts.filter(part => part.stock).map(part => getRomanPartBounds(part).max[1]));
    expect(bounds.min.y).toBeGreaterThan(stockTop + .035);
    geometry.dispose();
  }
});

it.each(quarryIds)("keeps resource %s ink visible through six real stock slots at native perspective views", id => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const) {
      const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      const part = recipe.parts.find(part => part.indigenousPigment)!;
      const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
      const ware = recipe.parts.find(part => part.stock)!.stock!.ware;
      model.update(0, { construction: 1, door: 0, working: false, inputStock: {}, outputStock: { [ware]: 6 } });
      model.root.updateMatrixWorld(true);
      const carrierGeometry = createIndigenousPigmentStoneSurface(part, detailed);
      carrierGeometry.scale(...part.size); carrierGeometry.translate(...part.position);
      carrierGeometry.applyMatrix4(model.root.matrixWorld);
      const carrierMaterial = new MeshBasicMaterial(), carrier = new Mesh(carrierGeometry, carrierMaterial);
      carrier.updateMatrixWorld(true);
      let painting: Mesh | undefined;
      const opaque: Mesh[] = [];
      model.root.traverse(object => {
        if (!(object instanceof Mesh) || !object.visible) return;
        for (let parent = object.parent; parent; parent = parent.parent) if (!parent.visible) return;
        if (object.userData.visualPigment) painting = object;
        if ((Array.isArray(object.material) ? object.material : [object.material]).every(material => !material.transparent))
          opaque.push(object);
      });
      expect(painting).toBeDefined();
      expect(opaque.some(mesh => mesh.userData.canonicalStock), "full physical stock must be in the ray occluders")
        .toBe(true);
      expect(new Set(opaque.filter(mesh => mesh.userData.canonicalStock)
        .map(mesh => mesh.userData.stock.slot)).size).toBe(6);
      const centre = new Box3().setFromObject(model.root).getCenter(new Vector3());
      for (const distance of [8, 15]) for (const [view, angle, elevation] of [["front", .30, .30],
        ["oblique", .65, .35], ["game", .65, .62]] as const) {
        const camera = new PerspectiveCamera(35, 1, .01, 100);
        camera.position.copy(centre).add(new Vector3(Math.sin(angle) * Math.sqrt(1 - elevation ** 2),
          elevation, Math.cos(angle) * Math.sqrt(1 - elevation ** 2)).multiplyScalar(distance));
        camera.lookAt(centre); camera.updateMatrixWorld(true);
        let visible = 0, sampled = 0;
        const external: unknown[] = [];
        const intrinsic: unknown[] = [];
        for (let row = 0; row < 16; row++) for (let column = 0; column < 16; column++) {
          const x = (column + .5) / 8 - 1, y = (row + .5) / 8 - 1;
          if (!indigenousCaveScene(part.indigenousPigment!, x, y) && !indigenousCaveMineral(part.indigenousPigment!, x, y)) continue;
          const target = new Vector3(part.position[0] + x * part.size[0] / 2,
            part.position[1] - y * part.size[1] / 2, 3).applyMatrix4(model.root.matrixWorld);
          const frontRay = new Raycaster(target, new Vector3(0, 0, -1).transformDirection(model.root.matrixWorld));
          const point = frontRay.intersectObject(painting!)[0]?.point;
          expect(point).toBeDefined(); if (!point) continue;
          const screen = point.clone().project(camera), ray = new Raycaster();
          ray.setFromCamera(new Vector2(screen.x, screen.y), camera);
          const ink = ray.intersectObject(painting!)[0], blocker = ray.intersectObjects(opaque)[0];
          sampled++;
          if (ink && (!blocker || blocker.distance >= ink.distance - .0002)) visible++;
          else {
            const blockerMesh = blocker?.object as Mesh | undefined;
            const surfaces = blockerMesh && (Array.isArray(blockerMesh.material)
              ? blockerMesh.material : [blockerMesh.material]);
            const originalCarrier = ray.intersectObject(carrier)[0];
            const onSameStoneWall = !!blocker && !blocker.object.userData.canonicalStock &&
              surfaces?.every(surface => surface.name === "indigenous_quarry_stone") &&
              !!originalCarrier && originalCarrier.point.distanceTo(blocker.point) < .001 &&
              blocker.point.distanceTo(point) < .04;
            const record = { x, y, blocker: blocker?.object.userData.buildingSurface,
              distance: blocker && ink && blocker.distance - ink.distance };
            if (onSameStoneWall) intrinsic.push(record);
            else external.push(record);
          }
        }
        expect(sampled).toBeGreaterThan(20);
        const scope = `${id}/L${level}/${detailed}/${view}/${distance}`;
        expect(external, `${scope}: stock, eave and racks must not hide any painted ink`).toEqual([]);
        // Physical paint follows deliberately uneven shoulders; retain its tiny natural self-shadow.
        expect(visible / sampled, `${scope}: ${JSON.stringify(intrinsic)}`).toBeGreaterThanOrEqual(.98);
      }
      carrierGeometry.dispose(); carrierMaterial.dispose();
      model.dispose();
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
