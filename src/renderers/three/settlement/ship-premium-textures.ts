import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture,TextureLoader } from "three";

import { SAIL_MATERIALS, type ShipMaterials,TIMBER_MATERIALS } from "./ship-materials";
import { NATION_SAIL_PAINTINGS, type SailPainting } from "./ship-nation-sails";
import { loadShipSailArtwork, type ShipSailArtwork } from "./ship-sail-artwork";

const paintBorder = (c: CanvasRenderingContext2D, color: string) => {
  c.fillStyle=color;c.fillRect(.015,.015,.045,.97);c.fillRect(.94,.015,.045,.97);
  c.fillRect(.06,.015,.88,.014);c.fillRect(.06,.971,.88,.014);
};

/** The raiders' mark: a blood-red coiled serpent painted over the dark, tarred sail. */
const paintRaiderSerpent = (c: CanvasRenderingContext2D) => {
  c.globalCompositeOperation = "source-over"; c.globalAlpha = .85;
  c.strokeStyle = "#8e1d15"; c.lineWidth = .075; c.lineCap = "round";
  c.beginPath(); c.moveTo(.28, .86);
  c.bezierCurveTo(.05, .62, .92, .6, .66, .38); c.bezierCurveTo(.52, .25, .34, .3, .42, .17); c.stroke();
  c.fillStyle = "#8e1d15"; c.beginPath(); c.ellipse(.47, .14, .085, .06, -.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#d9c9a0"; c.beginPath(); c.arc(.49, .12, .015, 0, Math.PI * 2); c.fill();
  c.globalAlpha = 1; c.globalCompositeOperation = "multiply";
};

/**
 * Sail paintings per livery and nation: the Roman eagle, the raiders' dark serpent sail, plain neutral and
 * the Viking, Japanese and Nubian sails (ship-nation-sails.ts).
 */
const SAIL_PAINTINGS: Record<(typeof SAIL_MATERIALS)[number], SailPainting> = {
  ...NATION_SAIL_PAINTINGS,
  cloth: (c, { eagle }) => { paintBorder(c, "#942f27"); if (eagle) c.drawImage(eagle, .14, .12, .72, .72); },
  enemyCloth: c => {
    c.fillStyle = "#4a403c"; c.fillRect(0, 0, 1, 1);
    paintBorder(c, "#1c1412");
    paintRaiderSerpent(c);
  },
  neutralCloth: c => paintBorder(c, "#8d8f90")
};

/** Original painted insignia, composed once onto the original sewn-linen bitmap. */
const decorateSail = (image: CanvasImageSource, size: number, paint: SailPainting, artwork: ShipSailArtwork) => {
  const canvas=document.createElement("canvas");canvas.width=canvas.height=size;
  const c=canvas.getContext("2d")!;c.drawImage(image,0,0,size,size);c.scale(size,size);
  c.globalCompositeOperation="multiply";
  paint(c, { ...artwork, cloth: image });
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;return texture;
};

export const loadShipPremiumTextures = (materials:ShipMaterials,detailed:boolean) => {
  const owned:Texture[]=[];let disposed=false;
  const own=(texture:Texture)=>{if(disposed)texture.dispose();else owned.push(texture);return texture;};
  const loader=typeof document==="undefined"?null:new TextureLoader();
  const grade=detailed?"high":"minimal";
  const timber=detailed?new URL("../../../../assets/textures/ships/roman-timber-high.webp",import.meta.url):new URL("../../../../assets/textures/ships/roman-timber-minimal.webp",import.meta.url);
  const linen=detailed?new URL("../../../../assets/textures/ships/roman-linen-high.webp",import.meta.url):new URL("../../../../assets/textures/ships/roman-linen-minimal.webp",import.meta.url);
  // Explicit static URLs let Vite copy and fingerprint these production assets.
  const ready=loader?Promise.all([
    loader.loadAsync(timber.href).then(texture=>{
      own(texture);if(disposed)return;texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;
      for(const name of TIMBER_MATERIALS){materials[name].map=texture;materials[name].needsUpdate=true;}
      materials.wood.color.setHex(0xffffff);materials.deck.color.setHex(0xdac7a7);
    }),
    Promise.all([loader.loadAsync(linen.href), loadShipSailArtwork(detailed)]).then(([texture, artwork])=>{
      if(disposed){texture.dispose();return;}
      for (const name of SAIL_MATERIALS) {
        const material = materials[name], paint = SAIL_PAINTINGS[name];
        material.map=own(decorateSail(texture.image,grade==="high"?1024:256,paint,artwork));
        material.color.setHex(0xffffff);material.needsUpdate=true;
      }
      texture.dispose();
    }),
    ...(detailed?[
      loader.loadAsync(new URL("../../../../assets/textures/ships/roman-timber-relief.webp",import.meta.url).href).then(texture=>{own(texture);if(disposed)return;texture.wrapS=texture.wrapT=RepeatWrapping;
        for(const name of ["wood","deck"] as const){materials[name].bumpMap=texture;materials[name].bumpScale=.008;materials[name].needsUpdate=true;}}),
      loader.loadAsync(new URL("../../../../assets/textures/ships/roman-linen-relief.webp",import.meta.url).href)
        .then(texture=>{
          own(texture);if(disposed)return;
          for(const name of SAIL_MATERIALS){
            materials[name].bumpMap=texture;materials[name].bumpScale=.002;materials[name].needsUpdate=true;
          }
        })
    ]:[])
  ]).then(()=>undefined).catch(()=>undefined):Promise.resolve();
  return {ready,dispose:()=>{disposed=true;owned.forEach(texture=>texture.dispose());owned.length=0;}};
};
