import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { buildingEntry } from "@shared/catalog";

import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "building-review-index-2026-11-03");
mkdirSync(output, { recursive: true });
const nations = ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"];
interface Card { nation: string; quality: string; name: string; source: string; status: string; path: string }
const cards: Card[] = [];
for (const nation of nations) {
  const folder = nation === "roman" ? resourcesPath("building-previews", "roman") :
    resourcesPath("building-previews", "nations", nation);
  for (const file of existsSync(folder) ? readdirSync(folder) : []) {
    const match = /^(\d+)-(high|minimal)\.png$/.exec(file);
    if (!match) continue;
    const name = buildingEntry(Number(match[1]))?.text.name.en;
    cards.push({ nation, quality: match[2]!, name: `${match[1]} · ${name ?? "Older building capture"}`,
      source: "earlier", status: "Earlier export — latest changes not synchronized", path: relative(output, resolve(folder, file)) });
  }
}
const recent = [
  { folder: "building-art-completion-2026-11-03/hq-cloud-masks-b", nation: "chinese",
    status: "Owner rejected roof/glyphs; longer lantern threads and filled clouds requested" },
  { folder: "building-art-completion-2026-11-03/hq-cloud-masks-c", nation: "maya",
    status: "Owner rejected masonry and gold faces — revision pending" },
  { folder: "persian-civic-rebuild-2026-11-03/ardashir-c", nation: "persian",
    status: "Structural prototype — richer monument decoration requested" },
  { folder: "hq-sewn-portal-and-lanterns-2026-11-03", nation: "indigenous",
    status: "Specific doorway/art revision verified — final assets pending" },
  { folder: "indigenous-rubble-well-2026-11-03/native", nation: "indigenous",
    status: "Rustic well revision verified — final assets pending" }
];
for (const source of recent) {
  const folder = resourcesPath("project-reviews", source.folder);
  for (const file of existsSync(folder) ? readdirSync(folder) : []) {
    if (!file.endsWith(".png") || source.nation === "indigenous" && file.includes("chinese")) continue;
    const quality = file.includes("minimal") ? "minimal" : "high";
    cards.push({ nation: source.nation, quality, name: file.replace(/\.png$/, ""), source: "recent",
      status: source.status, path: relative(output, resolve(folder, file)) });
  }
}
const data = JSON.stringify(cards).replaceAll("<", "\\u003c");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Building review — November 3</title><style>
body{margin:0;background:#222820;color:#f3ead4;font:16px system-ui}main{max-width:1500px;margin:auto;padding:24px}
h1{margin:0 0 12px}p{max-width:1000px;line-height:1.5}.notice{padding:14px;background:#59452c;border-left:4px solid #e7b968}
nav{display:flex;gap:16px;flex-wrap:wrap;position:sticky;top:0;background:#222820;padding:12px 0;z-index:1}
label{display:flex;gap:8px;align-items:center}select{padding:8px;background:#eee4cc;color:#25251e;border-radius:4px}
#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}article{background:#343c31;border-radius:8px;overflow:hidden}
img{display:block;width:100%;height:250px;object-fit:contain;background:#c7c8b5}h2{font-size:16px;margin:12px;overflow-wrap:anywhere}
article p{font-size:14px;margin:12px;color:#efd4a0}.empty{padding:30px}a{color:inherit}</style>
<main><h1>Building review · November 3</h1>
<p class="notice">The complete eight-nation screenshot set has NOT been regenerated after the latest changes.
Recent work below is explicitly marked. Chinese and Maya HQ captures were rejected by the owner and are awaiting corrections.
The Persian monument is awaiting a richer decoration pass. Earlier exports remain available for comparison.</p>
<nav><label>Nation <select id="nation"><option value="all">All eight nations</option>${nations.map(n => `<option>${n}</option>`).join("")}</select></label>
<label>Images <select id="source"><option value="recent">Recent work and open revisions</option><option value="earlier">Earlier exported buildings</option><option value="all">Both</option></select></label>
<label>Detail <select id="quality"><option value="high">High</option><option value="minimal">Minimal</option><option value="all">Both</option></select></label>
<span id="count"></span></nav><section id="gallery"></section></main>
<script>const data=${data};const gallery=document.getElementById('gallery');
function render(){const nation=document.getElementById('nation').value,source=document.getElementById('source').value,quality=document.getElementById('quality').value;
const selected=data.filter(c=>(nation==='all'||c.nation===nation)&&(source==='all'||c.source===source)&&(quality==='all'||c.quality===quality));
gallery.replaceChildren();document.getElementById('count').textContent=selected.length+' images';
for(const c of selected){const article=document.createElement('article'),link=document.createElement('a'),img=document.createElement('img'),title=document.createElement('h2'),status=document.createElement('p');
link.href=c.path;link.target='_blank';img.src=c.path;img.alt=c.nation+' '+c.name;img.loading='lazy';title.textContent=c.nation+' · '+c.name+' · '+c.quality;status.textContent=c.status;
link.append(img);article.append(link,title,status);gallery.append(article);}}
for(const id of ['nation','source','quality'])document.getElementById(id).addEventListener('change',render);render();</script></html>`;
writeFileSync(resolve(output, "index.html"), html);
writeFileSync(resolve(output, "images.json"), JSON.stringify(cards, null, 2));
console.log(JSON.stringify({ output, images: cards.length, nations: nations.length }));
