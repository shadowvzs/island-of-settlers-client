import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser } from "./browser";

const size = 192;
const supersample = 768;

const flaxSvg = () => {
  const n = 34;
  let stalks = "", seeds = "", highlights = "";
  for (let i = 0; i < n; i++) {
    const side = i / (n - 1) * 2 - 1;
    const jitter = Math.sin(i * 12.9898) * .5 + Math.cos(i * 7.13) * .5;
    const bottomX = 96 + side * 43 + jitter * 3;
    const bottomY = 168 - Math.abs(side) * 3;
    const topX = 96 + side * 32 + jitter * 5;
    const topY = 36 + Math.abs(side) * 9 + jitter * 4;
    const waistX = 96 + side * 25;
    const waistY = 103;
    const hue = 38 + (i % 5) * 2;
    const sat = 45 + (i % 4) * 4;
    const light = 42 + (i % 6) * 3;
    const d = `M${bottomX.toFixed(1)},${bottomY.toFixed(1)} C${waistX.toFixed(1)},${waistY} ${((waistX + topX) / 2).toFixed(1)},${((waistY + topY) / 2).toFixed(1)} ${topX.toFixed(1)},${topY.toFixed(1)}`;
    stalks += `<path d="${d}" fill="none" stroke="hsl(${hue} ${sat}% ${light}%)" stroke-width="${(1.2 + (i % 3) * .35).toFixed(2)}" stroke-linecap="round" opacity="${(.72 + (i % 4) * .06).toFixed(2)}"/>`;
    if (i % 3 === 0)
      highlights += `<path d="${d}" fill="none" stroke="#f7df9a" stroke-width=".55" stroke-linecap="round" opacity=".55"/>`;
    if (i % 2 === 0) {
      for (let k = -1; k <= 1; k++)
        seeds += `<ellipse cx="${(topX + k * 3.2).toFixed(1)}" cy="${(topY - 3 + Math.abs(k) * 1.6).toFixed(1)}" rx="2.4" ry="4.2" fill="url(#seed)" transform="rotate(${k * 12} ${topX} ${topY})"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${supersample}" height="${supersample}" viewBox="0 0 192 192">
  <defs>
    <radialGradient id="seed" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#e8c36d"/><stop offset=".55" stop-color="#b98232"/><stop offset="1" stop-color="#7a4c1b"/></radialGradient>
    <linearGradient id="tie" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#c7a36a"/><stop offset=".55" stop-color="#9a713b"/><stop offset="1" stop-color="#6f4a24"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <ellipse cx="96" cy="177" rx="54" ry="9" fill="#5a4328" opacity=".28" filter="url(#shadow)"/>
  <g>${stalks}${seeds}${highlights}</g>
  <path d="M61,99 C74,108 118,108 131,99 L130,108 C116,117 76,117 62,108 Z" fill="url(#tie)" stroke="#5d3f1e" stroke-width=".7"/>
  <path d="M62,103 C78,111 114,111 130,103" fill="none" stroke="#e0c18a" stroke-width=".8" opacity=".55"/>
  <path d="M129,103 l7,-4 l3,5 l-6,3 Z" fill="#b18950" stroke="#5d3f1e" stroke-width=".6"/>
  <path d="M133,106 C139,112 141,119 139,124" fill="none" stroke="#8a6234" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M137,105 C144,108 148,112 150,117" fill="none" stroke="#8a6234" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`;
};

const clothSvg = () => {
  const fringe = Array.from({ length: 15 }, (_, i) => {
    const x = 34 + i * 6.4, y = 129 + (i % 3) * 2;
    return `<path d="M${x},${y} C${x - 2},${y + 8} ${x + 2},${y + 14} ${x - 1},${y + 21}" stroke="#cfb98d" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  }).join("");
  const threadLines = Array.from({ length: 11 }, (_, i) =>
    `<path d="M130,${70 + i * 4.8} L160,${76 + i * 4.8}" stroke="#bda57b" stroke-width="1" opacity=".65"/>`).join("");
  const hank = Array.from({ length: 13 }, (_, i) => {
    const x = 18 + i * 2.4;
    return `<path d="M${x},55 C${x - 10},78 ${x + 12},99 ${x - 1},143" stroke="hsl(42 48% ${68 + i % 4 * 3}%)" stroke-width="1.2" fill="none" opacity=".9"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${supersample}" height="${supersample}" viewBox="0 0 192 192">
  <defs>
    <linearGradient id="cloth" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f4eedb"/><stop offset=".48" stop-color="#e3d5b4"/><stop offset="1" stop-color="#c6b083"/></linearGradient>
    <linearGradient id="fold" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff8e8"/><stop offset="1" stop-color="#d9c7a3"/></linearGradient>
    <linearGradient id="thread" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#d3b884"/><stop offset=".5" stop-color="#b6955f"/><stop offset="1" stop-color="#8d6e42"/></linearGradient>
    <linearGradient id="wood" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9a6c3a"/><stop offset="1" stop-color="#5f3d1d"/></linearGradient>
    <pattern id="weave" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0,0 H5 M0,2.5 H5 M0,0 V5 M2.5,0 V5" stroke="#b9a77c" stroke-width=".35" opacity=".55"/></pattern>
    <clipPath id="clothClip"><path d="M31,65 C55,49 105,50 123,63 L128,129 C103,144 55,143 30,128 Z"/></clipPath>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <ellipse cx="92" cy="171" rx="66" ry="10" fill="#5a4328" opacity=".25" filter="url(#shadow)"/>
  <g opacity=".92">${hank}</g>
  <path d="M29,72 C52,56 104,56 124,68 L129,132 C103,146 54,145 28,130 Z" fill="url(#cloth)" stroke="#a88c5e" stroke-width="1.1"/>
  <path d="M29,72 C52,56 104,56 124,68 L129,132 C103,146 54,145 28,130 Z" fill="url(#weave)" opacity=".65"/>
  <path d="M35,76 C58,62 100,62 119,72 L118,89 C98,80 57,80 34,92 Z" fill="url(#fold)" stroke="#b49a6c" stroke-width=".8"/>
  <path d="M41,77 C64,67 96,67 113,75" fill="none" stroke="#fffaf0" stroke-width="1.4" opacity=".75"/>
  <path d="M42,94 C66,86 98,86 119,94" fill="none" stroke="#b8a174" stroke-width=".8" opacity=".55"/>
  <path d="M38,112 C64,106 99,106 122,113" fill="none" stroke="#b8a174" stroke-width=".8" opacity=".45"/>
  <path d="M32,128 C58,141 103,141 127,129" fill="none" stroke="#a88c5e" stroke-width="1.2"/>
  ${fringe}
  <g transform="rotate(-7 146 96)">
    <path d="M128,62 L162,68 L158,125 L124,119 Z" fill="url(#thread)" stroke="#6f512f" stroke-width="1"/>
    <g clip-path="none">${threadLines}</g>
    <ellipse cx="145" cy="65" rx="17" ry="5" fill="#8f6a3e" stroke="#5e3f20" stroke-width=".8"/>
    <ellipse cx="145" cy="65" rx="5" ry="1.8" fill="#4d3218"/>
    <ellipse cx="141" cy="122" rx="17" ry="5" fill="#7d5a31" stroke="#5e3f20" stroke-width=".8"/>
    <ellipse cx="141" cy="122" rx="5" ry="1.8" fill="#3f2913"/>
    <path d="M159,71 C169,80 164,93 171,100" fill="none" stroke="#b6955f" stroke-width="1.2"/>
  </g>
  </svg>`;
};

const { browser, page } = await (async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 4 });
  return { browser, page };
})();
try {
  const output = resolve("assets/ware-icons");
  mkdirSync(output, { recursive: true });
  for (const [name, svg] of [["flax", flaxSvg()], ["cloth", clothSvg()]] as const) {
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent;width:${size}px;height:${size}px}svg{display:block}</style>${svg}`);
    const data = await page.evaluate(async ({ svg, size, supersample }) => {
      const image = new Image();
      const blob = new Blob([svg], { type: "image/svg+xml" });
      image.src = URL.createObjectURL(blob);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext("2d")!;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, image.width, image.height, 0, 0, size, size);
      return canvas.toDataURL("image/png");
    }, { svg, size, supersample });
    writeFileSync(resolve(output, `${name}.png`), Buffer.from(data.split(",")[1]!, "base64"));
    console.log(`wrote ${name}.png`);
  }
} finally {
  await browser.close();
}
