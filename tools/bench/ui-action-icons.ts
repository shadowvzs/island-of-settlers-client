import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { renderUiActionIcon, setupUiActionIconRenderer } from "./ui-action-icon-renderer";

/**
 * Renders the HUD action icons (launcher, build tools, window close, menu entries, section headers)
 * from original 3D models into 128 px WebP files. Usage: npx tsx tools/bench/ui-action-icons.ts [names...]
 * `--set=ai` renders the map-editor Computer faction icons into `assets/ui-icons/ai` instead.
 */
const setArgument = process.argv.find(argument => argument.startsWith("--set="));
const set = setArgument?.slice("--set=".length) ?? "actions";
const output = resolve(set === "ai" ? "assets/ui-icons/ai" : "assets/ui-icons/actions");
const reviewArgument = process.argv.find(argument => argument.startsWith("--review-dir="));
const review = resolve(
  reviewArgument?.slice("--review-dir=".length) ?? process.env.ICON_REVIEW_DIR ?? "../resources/settlement-previews/icon-review"
);
mkdirSync(output, { recursive: true });

/** People: upper bodies of two rendered game settlers (carrier behind, builder in front). */
const composePeople = async (base: string) => {
  const load = (name: string) =>
    new Promise<HTMLImageElement>((done, fail) => {
      const image = new Image();
      image.onload = () => done(image);
      image.onerror = fail;
      image.src = `${base}assets/worker-icons/${name}.png`;
    });
  const [carrier, builder] = await Promise.all([load("carrier"), load("builder")]);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.filter = "brightness(.82)";
  context.drawImage(carrier, 78, 20, 100, 118, -4, 0, 96, 114);
  context.filter = "none";
  context.drawImage(builder, 74, 20, 100, 118, 34, 10, 100, 118);
  // Soft fade at the waist instead of a hard crop line.
  const fade = context.createLinearGradient(0, 100, 0, 128);
  fade.addColorStop(0, "#0000");
  fade.addColorStop(1, "#000f");
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = fade;
  context.fillRect(0, 100, 128, 28);
  return canvas.toDataURL("image/webp", 0.9).split(",")[1]!;
};
mkdirSync(review, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/ui-action-icons.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>"
    })
  );
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}ui-action-icons.html`);
  const available = await page.evaluate(setupUiActionIconRenderer, set);
  const requested = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
  const names = requested.length
    ? available.filter((name) => requested.includes(name))
    : available;
  const icons: Record<string, string> = {};
  for (const name of names) icons[name] = await page.evaluate(renderUiActionIcon, name);
  if (set === "actions" && (!requested.length || requested.includes("people")))
    icons.people = await page.evaluate(composePeople, url);
  for (const [name, data] of Object.entries(icons))
    writeFileSync(resolve(output, `${name}.webp`), Buffer.from(data, "base64"));
  const cards = Object.entries(icons).map(([name, data]) => {
    const source = `data:image/webp;base64,${data}`;
    return (
      `<figure><img src="${source}" width="96"><img src="${source}" width="42"><img src="${source}" width="23">` +
      `<figcaption>${name}</figcaption></figure>`
    );
  });
  const sheet = (
    background: string
  ) => `<style>body{margin:0;padding:16px;background:${background};font:13px serif}
    main{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}figure{margin:0;padding:6px;display:flex;
    align-items:end;gap:6px;flex-wrap:wrap;border:1px solid #9b7b52;border-radius:8px}figcaption{width:100%;color:#888}
    </style><main>${cards.join("")}</main>`;
  for (const [theme, background] of [
    ["light", "#efe2c4"],
    ["dark", "#2f261c"]
  ] as const) {
    await page.setContent(sheet(background));
    await page.screenshot({
      path: resolve(review, `ui-${set === "ai" ? "ai" : "action"}-icons-${theme}.png`),
      fullPage: true
    });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Saved ${Object.keys(icons).length} UI action icons to ${output}; sheets in ${review}`
  );
} finally {
  await browser.close();
  await server.close();
}
