import { type Material, type Mesh, type MeshStandardMaterial, PropertyBinding, type Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const verifyBuildingLibraryReload = async (bytes: ArrayBuffer, expectedNames: string[]) => {
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  try {
    const names = gltf.animations.map(clip => clip.name).sort();
    if (JSON.stringify(names) !== JSON.stringify([...expectedNames].sort()))
      throw new Error("Official GLTFLoader dropped or renamed library clips");
    let tracks = 0;
    for (const clip of gltf.animations) {
      if (!clip.tracks.length) throw new Error(`Official reload has empty clip: ${clip.name}`);
      for (const track of clip.tracks) {
        const binding = PropertyBinding.parseTrackName(track.name);
        if (!PropertyBinding.findNode(gltf.scene, binding.nodeName))
          throw new Error(`Official reload animation target missing: ${clip.name}/${track.name}`);
        tracks++;
      }
    }
    let roots = 0, anchors = 0;
    gltf.scene.traverse(node => {
      if (node.userData.nation) roots++;
      if (node.userData.exportHiddenDoorAnchor) {
        if ((node as Mesh).isMesh || node.children.length) throw new Error("Hidden animation anchor gained geometry");
        anchors++;
      }
    });
    if (roots !== 57 || anchors !== 1) throw new Error(`Unexpected model/empty-anchor count: ${roots}/${anchors}`);
    return { officialReloadPassed: true, clips: names.length, tracks, modelRoots: roots,
      nonrenderingWellAnchors: anchors, allTargetsBound: true };
  } finally {
    const geometries = new Set<Mesh["geometry"]>(), materials = new Set<Material>(), textures = new Set<Texture>();
    gltf.scene.traverse(node => {
      if (!(node as Mesh).isMesh) return;
      const mesh = node as Mesh; geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const slot of ["map", "alphaMap", "aoMap", "normalMap", "metalnessMap", "roughnessMap", "emissiveMap"] as const) {
          const texture = (material as MeshStandardMaterial)[slot]; if (texture) textures.add(texture);
        }
      }
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    const images = new Set<unknown>();
    textures.forEach(texture => { images.add(texture.image); texture.dispose(); });
    for (const image of images) if (image && typeof image === "object" && "close" in image && typeof image.close === "function")
      image.close();
  }
};

export const reloadRetainedBuildingLibraries = async () => {
  const results = [];
  for (const nation of ["roman", "viking", "nubian", "japanese"]) for (const quality of ["high", "minimal"]) {
    const response = await fetch(`/assets/buildings/${nation}/${nation}-library-${quality}.glb`);
    if (!response.ok) throw new Error(`Retained GLB fetch failed: ${nation}/${quality}`);
    const bytes = await response.arrayBuffer(), length = new DataView(bytes).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
    const names = json.animations.map((clip: { name: string }) => clip.name);
    for (const clip of json.animations) for (const channel of clip.channels)
      if (!Number.isInteger(channel.target.node) || !json.nodes[channel.target.node])
        throw new Error(`Retained raw channel still unbound: ${clip.name}`);
    results.push({ nation, quality, ...await verifyBuildingLibraryReload(bytes, names) });
  }
  return results;
};
