import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderArmyIcons } from "./army-icon-renderer";
import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/army-icons");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/army-icon-review.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.addInitScript("window.__name=value=>value;");
  await page.goto(`${url}army-icon-review.html`);
  const images = await page.evaluate(renderArmyIcons);
  for (const result of images) writeFileSync(resolve("assets/ui-icons", `${result.name}.png`), Buffer.from(result.data.split(",")[1]!, "base64"));
  assert.deepEqual(errors, []);
  const cells = images.map(result => `<div><img src="${result.data}" width="44" height="44"><img src="${result.data}" width="96" height="96"><span>${result.name.replace("army-", "")}</span></div>`).join("");
  await page.setContent(`<body style="margin:0;background:#30291f;color:#ead8b1;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:24px">${cells}<style>div{border:1px solid #947347;background:#4d3c2a;display:flex;align-items:center;gap:8px;padding:12px}img{object-fit:contain;flex-shrink:0}span{max-width:100px}</style></body>`);
  await page.screenshot({ path: resolve(output, "all-nations-44px-and-96px.png"), fullPage: true });
  // Optional before/after sheet: only when a "before" export was saved next to the review output.
  if (existsSync(resolve(output, "before"))) {
    const comparison = ["roman", "viking", "nubian", "japanese"].map(nation => {
      const before = `data:image/png;base64,${readFileSync(resolve(output, "before", `army-${nation}-archer.png`)).toString("base64")}`;
      const after = images.find(image => image.name === `army-${nation}-archer`)!.data;
      return `<div><span>${nation}</span><img width="44" height="44" src="${before}"><img width="44" height="44" src="${after}"><img width="96" height="96" src="${before}"><img width="96" height="96" src="${after}"></div>`;
    }).join("");
    await page.setContent(`<body style="background:#30291f;color:#ead8b1;font:16px sans-serif;padding:24px"><p>Before / after at 44 px and 96 px</p>${comparison}<style>div{background:#4d3c2a;border:1px solid #947347;display:flex;align-items:center;gap:20px;padding:20px;margin:12px}span{width:100px}img{object-fit:contain}</style></body>`);
    await page.screenshot({ path: resolve(output, "archer-before-after-44px.png"), fullPage: true });
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ errors,
    icons: images.map(({ data, ...result }) => result) }, null, 2));
  console.log(images.map(({ data, ...result }) => result));
} finally { await browser.close(); await server.close(); }
