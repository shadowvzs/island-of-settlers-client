import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { INDIGENOUS_BUILDING_MOTIFS } from "../../src/render-common/buildings/indigenous-building-motifs";
import { indigenousCaveArtAtlas } from "../../src/renderers/three/buildings/indigenous-cave-art-atlas";
import { encodePng } from "../dev/png";

const output = resolve("../resources/project-reviews/building-art-completion-2026-11-03/indigenous-brown-motifs-a");
mkdirSync(output, {recursive:true});
const size=160, width=size*5,height=size*4,pixels=new Uint8Array(width*height*4);
for(let motif=0;motif<INDIGENOUS_BUILDING_MOTIFS.length;motif++) {
  const column=motif%5,row=Math.floor(motif/5),icon=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const nx=x/(size-1)*2.15-1.075,ny=y/(size-1)*2.15-1.075;
    const grain=.5+Math.sin(x*91.72+y*36.21)*.42;
    const colour=indigenousCaveArtAtlas({u:(column+.145+nx*.12)/5,v:(row+.62+ny*.19)/4,
      grain,mineral:.5,weather:.25});
    for(let channel=0;channel<4;channel++) {
      const value=channel===3?255:Math.max(0,Math.min(255,[219,205,176][channel]!*colour.colour[channel]!*colour.brightness));
      pixels[((row*size+y)*width+column*size+x)*4+channel]=value;
      icon[(y*size+x)*4+channel]=value;
    }
  }
  writeFileSync(resolve(output,`${INDIGENOUS_BUILDING_MOTIFS[motif]}.png`),encodePng(size,size,icon));
}
writeFileSync(resolve(output,"sheet.png"),encodePng(width,height,pixels));
writeFileSync(resolve(output,"index.html"),`<!doctype html><meta charset="utf-8"><title>Original brown textile motifs · CPU draft</title><style>body{font:16px system-ui;background:#ddd6c3}main{display:grid;grid-template-columns:repeat(5,160px);gap:14px}figure{margin:0}img{width:160px}</style><h1>Brown textile motifs · CPU draft</h1><p>Original code-authored draft. These magnified pigment areas are not yet integrated or native accepted.</p><main>${INDIGENOUS_BUILDING_MOTIFS.map(motif=>`<figure><img src="${motif}.png"><figcaption>${motif}</figcaption></figure>`).join("")}</main>`);
console.log(output);
