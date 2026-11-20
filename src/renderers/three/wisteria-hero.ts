import { Group, InstancedMesh, Mesh, type MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import type { WisteriaRoadFrame } from "../../render-common/road-decoration-wisteria";
import { createWisteriaHeroGraph } from "../../render-common/wisteria-hero-graph";
import { createRoadDecorationModel } from "./road-decoration-model";
import { createWisteriaBotanicalTemplates } from "./wisteria-botanical-templates";
import { createWisteriaHeroFrame } from "./wisteria-hero-frame";
import { createWisteriaPetioleGeometry } from "./wisteria-petiole-geometry";
import { createWisteriaWoodyGeometry, type WisteriaWoodPoint } from "./wisteria-woody-geometry";

/** ONE reference-study High purple hero. Unregistered; its measured topology is not a production budget. */
export const createWisteriaHero = (frameMaterials: Record<BuildingSurface, MeshStandardMaterial>,
  suppliedTemplates?: ReturnType<typeof createWisteriaBotanicalTemplates>, options: { minimal?: boolean; lean?: boolean; coarseBotany?: boolean; frame?: WisteriaRoadFrame; flowerPalette?: readonly [number, number, number] } = {}) => {
  const templates = suppliedTemplates ?? createWisteriaBotanicalTemplates({ lean: options.lean });
  const root = new Group(); root.name = "wisteria_reference_hero_unaccepted";
  const frameKind = options.frame ?? "curved";
  const frame = createWisteriaHeroFrame(frameKind, options.minimal ?? false);
  const timber = createRoadDecorationModel({ definition: { id: "wisteria-reference-hero" }, parts: frame, wind: 0 }, frameMaterials, !options.minimal);
  root.add(timber.root);
  const wood: ReturnType<typeof createWisteriaWoodyGeometry>[] = [], twigs: typeof wood = [];
  const graph = createWisteriaHeroGraph(frameKind);
  const { composition, flowers, inspection, leaves } = graph;
  const limb = (points: WisteriaWoodPoint[], base: number, tip: number,
    settings: { fine?: boolean; grounded?: boolean; keepCurve?: boolean; retainMinimal?: boolean } = {}) => {
    const fine = settings.fine ?? false;
    if ((options.minimal || options.coarseBotany) && fine && !settings.retainMinimal) return;
    if (((options.minimal || options.coarseBotany) && fine) || (options.lean && fine && points.length === 2)) {
      twigs.push(createWisteriaPetioleGeometry(points[0]!, points.at(-1)!, base)); return;
    }
    const segments = Math.max(1, points.length - 1);
    let sides = fine ? 3 : 6;
    if (options.minimal) sides = 4;
    const reduce = options.minimal && !settings.keepCurve;
    const geometry = createWisteriaWoodyGeometry(points, base, tip,
      reduce ? Math.max(1, Math.ceil(segments / 2)) : segments, sides, settings.grounded);
    (fine ? twigs : wood).push(geometry);
  };
  for (const branch of graph.limbs) limb(branch.points, branch.base, branch.tip, branch.settings);
  const plant = templates.instantiate(flowers, leaves, options.flowerPalette); root.add(plant.root);
  const merged: ReturnType<typeof createWisteriaWoodyGeometry>[] = [];
  for (const [parts, material] of [[wood, templates.materials.bark], [twigs, templates.materials.calyx]] as const) {
    if (!parts.length) continue;
    const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
    if (!geometry) throw new Error("Wisteria hero branch merge failed");
    merged.push(geometry); const mesh = new Mesh(geometry, material);
    mesh.name = parts === wood ? "wisteria_aged_wood" : "wisteria_rachises_pedicels";
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  let disposed = false;
  const topology: { module: string; instances: number; templateTriangles: number; visibleTriangles: number }[] = [];
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const templateTriangles = (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3;
    const instances = node instanceof InstancedMesh ? node.count : 1;
    topology.push({ module: node.name, instances, templateTriangles, visibleTriangles: templateTriangles * instances });
  });
  return { root, topology, inspection, botany: { flowers, leaves, composition, frame: frameKind }, counts: graph.counts, dispose: () => {
    if (disposed) return; disposed = true;
    timber.dispose(); plant.dispose(); merged.forEach(geometry => geometry.dispose());
    if (!suppliedTemplates) templates.dispose(); root.removeFromParent(); root.clear();
  } };
};
