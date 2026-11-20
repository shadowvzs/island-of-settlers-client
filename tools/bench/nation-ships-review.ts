import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Every nation's player ship (and the raider / neutral liveries) in native Three.js, High and Minimal:
 * close quarter, gameplay distance, broadside, bow, stern and top views, under sail and loaded with
 * the deck's demo crates. NATIONS / QUALITIES / VIEWS (comma lists) narrow the run ("raider" in NATIONS
 * shows the raiders' galley); OUT overrides the folder.
 */
const output = process.env.OUT ? resolve(process.env.OUT) : resourcesPath("settlement-previews", "nation-ships");
mkdirSync(output, { recursive: true });
const nations = (process.env.NATIONS ?? "roman,viking,japanese,nubian,raider").split(",");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const VIEWS = (process.env.VIEWS ??
  "close,game,broadside,bow,stern,top,shields,figurehead,loaded,loaded-game,enemy,fleet").split(",");
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
const traders = process.env.TRADE_SHIPS === "1";
const winds=(process.env.WIND_DIRECTIONS??".4").split(",").map(Number);
assert(winds.length>0&&winds.every(Number.isFinite),"finite wind directions required");
const playerColor = process.env.PLAYER_COLOR ? JSON.parse(process.env.PLAYER_COLOR) as [number, number, number] : undefined;
try {
  for (const quality of qualities) for (const nation of nations) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/nation-ships-review.html", route => route.fulfill({ contentType: "text/html",
      body: "<!doctype html><body style='margin:0'>" }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}nation-ships-review.html`);
    const report = await page.evaluate(async ({ nation, playerColor, quality, traders, views, winds }) => {
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { createThreeSettlementShips } = await import(
        /* @vite-ignore */ String("/src/renderers/three/settlement/three-ships.ts"));
      const { layoutShipDeck } = await import(/* @vite-ignore */ String("/src/render-common/ships/ship-deck-layout.ts"));
      const layer = createThreeSettlementShips(quality); await layer.ready;
      const crates = layoutShipDeck({ depth: .5, height: 1.3, width: .54 }, 0, Infinity).slots;
      const raider = nation === "raider", playerNation = raider ? "roman" : nation;
      let ship: any = { cargoCount: 0, id: 1, livery: raider ? "enemy" : undefined, phase: "idle", x: 0, y: 0, yaw: 0, z: 0 };
      if (traders) {
        const { shipFrame } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-naval-ship-handling.ts"));
        ship = shipFrame({ ...ship, id: 4 + ["roman", "viking", "japanese", "nubian"].indexOf(nation),
          cargo: {}, passengers: [], route: [], cursor: 0, timer: 0,
          visitor: { role: "trade", trade: { delivery: "native-review", queue: 1 } } });
      }
      const renderer = new three.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight);
      renderer.shadowMap.enabled = quality === "high";
      document.body.append(renderer.domElement);
      const scene = new three.Scene(); scene.background = new three.Color("#bec3ad"); scene.add(layer.group);
      scene.add(new three.HemisphereLight("#fff1db", "#667854", 2));
      const sun = new three.DirectionalLight("#fff1db", 2.5); sun.position.set(6, 12, 8); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { bottom: -8, left: -8, right: 8, top: 8 }); scene.add(sun);
      const water = new three.Mesh(new three.PlaneGeometry(80, 80),
        new three.MeshStandardMaterial({ color: "#4d8995", roughness: .35 }));
      water.rotation.x = -Math.PI / 2; water.position.y = -.38; water.receiveShadow = true; scene.add(water);
      const camera = new three.PerspectiveCamera(32, innerWidth / innerHeight, .01, 200);
      const place: Record<string, [number[], number[]]> = {
        mast: [[2.7, 9.6, 4.8], [0, 8.7, .4]],
        bow: [[5, 4.5, 15], [0, 2.4, 0]], broadside: [[21, 5, 0], [0, 4.8, 0]], close: [[16, 12, 16], [0, 4.2, 0]],
        enemy: [[22, 22, 26], [6, 1.5, 0]], figurehead: [[3.4, 4.3, 8.4], [0, 3, 4.4]],
        fleet: [[30, 30, 36], [6, 1.5, 0]], game: [[24, 24, 29], [0, 2, 0]],
        loaded: [[9, 11, 10], [0, 1.2, 0]], "loaded-game": [[24, 24, 29], [0, 2, 0]],
        shields: [[3.9, 1.35, 1.2], [1.65, 1, .5]], stern: [[-6, 6, -15], [0, 2.4, 0]], top: [[.01, 26, 0], [0, 0, 0]]
      };
      // The Chinese mast extension must be visible in the acceptance views, including its flag.
      if (nation === "chinese") {
        place.mast = [[4.5, 12.2, 9], [0, 10.6, .4]];
        place.close = [[18, 15, 18], [0, 5.5, 0]];
      }
      const captures: { name: string; png: string }[] = [];
      for (const view of views) for(const [windIndex,windDirection] of winds.entries()) {
        const [eye, target] = place[view]!;
        camera.position.set(eye[0]!, eye[1]!, eye[2]!); camera.lookAt(target[0]!, target[1]!, target[2]!);
        const loaded = view.startsWith("loaded"), raiders = view === "enemy" || view === "fleet";
        const ships = [{ ...ship, demoCrates: loaded ? crates : undefined, phase: loaded ? "loading" : "sailing" },
          ...(raiders ? [{ ...ship, id: 2, livery: "enemy", x: 12, yaw: .6 },
            { ...ship, id: 3, livery: "neutral", x: 6, yaw: -.4, z: -10 }] : [])];
        layer.update(ships, [], 1.7, { cameraX: camera.position.x, cameraY: camera.position.y,
          cameraZ: camera.position.z, playerNation, playerColor, windDirection, windStrength: .9 });
        renderer.render(scene, camera);
        captures.push({ name: winds.length>1?`${view}-wind-${windIndex}`:view, png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
      }
      layer.update([ship], [], 0, { playerNation, playerColor });
      layer.group.updateMatrixWorld(true);
      let triangles = 0;
      const bounds = new three.Box3(), part = new three.Box3();
      layer.group.traverseVisible((object: any) => {
        if (!object.isMesh) return;
        triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
        object.geometry.computeBoundingBox();
        bounds.union(part.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
      });
      renderer.render(scene, camera);
      const draws = renderer.info.render.calls;
      const flag = layer.group.getObjectByName("ship_flag") as any;
      const flagColor = flag.material.color.toArray();
      if (traders && (ship.livery !== "neutral" || ship.nation !== nation ||
        flagColor.some((value: number, index: number) => Math.abs(value - [.55, .56, .56][index]!) > .000001)))
        throw new Error("Trade frame or neutral flag differs from the canonical runtime contract");
      layer.dispose();
      return { bounds: bounds.getSize(new three.Vector3()).toArray(), captures, draws, triangles, flagColor, frameNation: ship.nation, livery: ship.livery };
    }, { nation, quality, views: VIEWS, traders, playerColor, winds });
    assert.deepEqual(errors, []);
    for (const capture of report.captures)
      writeFileSync(resolve(output, `${nation}-${quality}-${capture.name}.png`), Buffer.from(capture.png, "base64"));
    reports.push({ bounds: report.bounds, draws: report.draws, nation, quality, triangles: report.triangles, winds, traders, frameNation: report.frameNation, flagColor: report.flagColor, livery: report.livery });
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await server.close(); }
