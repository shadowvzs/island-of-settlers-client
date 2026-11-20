import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve("../resources/settlement-previews/rigged-animation-audit");
const report = JSON.parse(readFileSync(resolve(directory, "review.json"), "utf8"));
const variants = [...new Set(report.map((entry: { variant: string }) => entry.variant))];
writeFileSync(resolve(directory, "index.html"), `<!doctype html><meta charset="utf-8">
<title>Character animation audit</title><style>
body{margin:20px;background:#20261f;color:#eee;font:16px system-ui}select{margin:8px;padding:6px}
img{display:block;max-width:100%;height:auto}a{color:#ddd}p{max-width:85ch}
</style><h1>Character animation audit</h1>
<p>24 bodies × civilian/three armour ranks × 31 clips × three sampled phases × High/Minimal:
17,856 checked poses. All transforms and mesh bounds are finite. These sheets use the game poser,
armour attachments and selected LOD. Contextual weapon/tool contacts have separate runtime reviews.</p>
<label>Body and armour<select id="variant"></select></label>
<label>Detail<select id="quality"><option>high</option><option>minimal</option></select></label>
<label>Phase/view<select id="phase"><option>0</option><option selected>0.5</option><option>0.95</option><option>normal</option></select></label>
<p id="caption"></p><a id="original"><img id="sheet" alt="31 animation poses"></a>
<script>
const variants=${JSON.stringify(variants)};
for(const name of variants)variant.add(new Option(name,name));
variant.value='japanese-man-grey--soldier';
const update=()=>{const path=quality.value+'-'+variant.value+'-'+phase.value+'.png';
sheet.src=path;original.href=path;caption.textContent=variant.value+' · '+quality.value+' · '+phase.value;};
for(const input of [variant,quality,phase])input.onchange=update;update();
</script>`);
console.log(resolve(directory, "index.html"));
