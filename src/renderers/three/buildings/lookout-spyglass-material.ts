import { MeshStandardMaterial, SRGBColorSpace, Texture, TextureLoader } from "three";

import { productionBuildingIconSource } from "../../../render-common/buildings/production-icon-sources";
import { ownBuildingMaterial } from "./building-material-ownership";

let shared: { disposed: boolean; texture: Texture; users: number } | undefined;

/** One shared close-up bitmap across facade templates and road signs; each owner has its own material. */
export const createLookoutSpyglassMaterial = (vertexColors = true) => {
  if (!shared) {
    const entry = { disposed: false, texture: new Texture(), users: 0 };
    if (typeof document !== "undefined") entry.texture = new TextureLoader().load(productionBuildingIconSource(14)!, loaded => {
      if (!entry.disposed) return;
      (loaded as Texture).image = null;
    });
    entry.texture.addEventListener("dispose", () => { entry.disposed = true; entry.texture.image = null; });
    entry.texture.colorSpace = SRGBColorSpace; shared = entry;
  }
  const entry = shared; entry.users++;
  const material = new MeshStandardMaterial({ alphaTest: .05, map: entry.texture, roughness: .92,
    color: "#ffffff", metalness: 0, transparent: true, vertexColors });
  ownBuildingMaterial(material, undefined, true);
  let released = false;
  material.addEventListener("dispose", () => {
    if (released) return;
    released = true;
    if (--entry.users !== 0) return;
    if (shared === entry) shared = undefined;
  });
  return material;
};
