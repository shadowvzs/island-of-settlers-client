import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GALLERY_NATIONS,type GalleryCase, type GalleryView } from "./building-gallery-plan";

export interface GalleryCard extends GalleryCase { file: string; view: GalleryView; triangles: number; withinBudget: boolean }
export const writeGalleryIndex = (output: string, cards: readonly GalleryCard[], status: {
  mode: string; variants: number; capturedVariants: number; omitted: number; frames: number; complete: boolean; native: boolean;
  passed: boolean; sheets: readonly string[];
  indexFile?: string; reportFile?: string; sourceManifestFile?: string;
}) => {
  const data = JSON.stringify(cards).replaceAll("<", "\\u003c");
  const notice = status.native ? "Fresh canonical model captures; visual inspection and explicit owner approval remain required." :
    "CPU PREPARATION ONLY — no native images have been captured in this run.";
  const coverage = status.complete ? "All five levels completed with passing native/source guards." :
    `INCOMPLETE COVERAGE: ${status.variants - status.capturedVariants} planned variants remain, ${status.omitted} all-level variants are outside this plan. This cannot approve the complete all-level matrix.`;
  writeFileSync(resolve(output, status.indexFile ?? "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Integrated building review</title>
<style>body{margin:0;background:#242a23;color:#eee8d6;font:16px system-ui}main{max-width:1600px;margin:auto;padding:20px}
p{line-height:1.5;max-width:1150px}.notice{background:#56452c;padding:14px}a{color:#e9dcae}
nav{display:flex;gap:12px;flex-wrap:wrap;position:sticky;top:0;background:#242a23;padding:12px 0;z-index:1}
select{padding:8px}#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
figure{margin:0;background:#343c31}figure img{width:100%;display:block}figcaption{padding:10px;font-size:14px}
details{margin:16px 0}details a{display:inline-block;margin:6px}</style><main>
<h1>Integrated building review · ${status.mode}</h1><p class="notice">${notice}<br>${coverage}<br>
${status.variants} nation/type/level/LOD variants · ${status.frames} planned frames · ${cards.length} captured images.
Native guards: ${status.native ? String(status.passed) : "not run"}. No production library/icon output or deployment.</p>
<p>Canonical models include current windows, doors, floor finishes and Indigenous hides. Front/rear images keep the
complete model. Optional interior images use an explicitly diagnostic horizontal clipping plane; they do not change
the runtime model. Closed exterior views cannot establish hidden floor quality. All levels share each building's
level-5 framing. Construction complete, door closed, work stopped, fixed time/wind; shadows follow the selected LOD.</p>
<p><a href="plan.json">Exact planned and omitted coverage</a> · <a href="${status.reportFile ?? "report.json"}">Native report</a> ·
<a href="${status.sourceManifestFile ?? "source-manifest.json"}">Requested source/asset hashes</a></p>
<details><summary>Contact sheets (${status.sheets.length})</summary>${status.sheets.map(file =>
    `<a href="${file}" target="_blank">${file}</a>`).join("")}</details>
<nav><label>Nation <select id="nation">${GALLERY_NATIONS.map(value => `<option>${value}</option>`).join("")}<option value="all">All</option></select></label>
<label>Detail <select id="quality"><option>high</option><option>minimal</option><option value="all">Both</option></select></label>
<label>Level <select id="level">${[1, 2, 3, 4, 5].map(value => `<option>${value}</option>`).join("")}<option value="all">All</option></select></label>
<label>View <select id="view"><option>front</option><option>rear</option><option>interior</option><option value="all">All</option></select></label>
<span id="count"></span></nav><section id="gallery"></section></main><script>
const cards=${data};function render(){const selected=cards.filter(card=>['nation','quality','level','view'].every(key=>{
const value=document.getElementById(key).value;return value==='all'||String(card[key])===value}));
document.getElementById('count').textContent=selected.length+' images';const gallery=document.getElementById('gallery');gallery.replaceChildren();
for(const card of selected){const figure=document.createElement('figure'),link=document.createElement('a'),image=document.createElement('img'),caption=document.createElement('figcaption');
link.href=card.file;link.target='_blank';image.src=card.file;image.loading='lazy';image.alt=card.nation+' '+card.name+' '+card.view;
caption.textContent=card.nation+' · '+card.id+' '+card.name+' · L'+card.level+' · '+card.quality+' · '+card.view+
(card.view==='interior'?' DIAGNOSTIC':'')+' · '+card.triangles+' tris'+(card.withinBudget?'':' · ORIGINAL CAP EXCEEDED');
link.append(image);figure.append(link,caption);gallery.append(figure)}}for(const key of ['nation','quality','level','view'])document.getElementById(key).addEventListener('change',render);render();
</script></html>`);
};
