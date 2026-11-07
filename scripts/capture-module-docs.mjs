// Run after npm run build. Screenshots use the real application and WASM worker.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(
    dist,
    "." +
      decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
  );
  if (
    !file.startsWith(dist + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await browser.defaultBrowserContext().overridePermissions(origin, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const click = label => page.evaluate(label => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === label).click(), label);
  const ready = () => page.waitForFunction(() => document.querySelector("button")?.disabled === false);
  const exact = () => page.waitForFunction(() => [...document.querySelectorAll(".studio-legend")].some(e => e.textContent.includes("Exact geometry up to date")), {timeout:90000});
  const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shot = async name => {await frame(); await page.screenshot({path:path.join(root, `docs/images/${name}.png`)});};
  await page.goto(origin + "/?studio=1");
  await ready();
  await click("＋ box");
  await page.waitForFunction(() => document.querySelector("footer")?.textContent.includes("Saved locally"));
  await Promise.all([page.waitForNavigation(),page.click('a[href="?"]')]);
  await page.waitForSelector(".monaco-editor .view-lines", {timeout:45000});
  const original = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
  const flower = fs.readFileSync(path.join(root,"examples/forma3d/flower-modules.scad"),"utf8");
  await page.evaluate(text => navigator.clipboard.writeText(text), original + "\n" + flower);
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.press("V"); await page.keyboard.up("Control");
  await frame();
  await page.click('a[href="?studio=1"]');
  await page.waitForSelector('section[aria-label="Import detected modules"]', {timeout:60000});
  await shot("module-import-review");
  await Promise.all([page.waitForNavigation(),click("Save selected modules and return")]);
  await ready();
  page.once("dialog",d=>d.accept());
  await click("New");
  await page.click(".studio-module-library summary");
  await page.select('select[aria-label="Library module"]',"petal");
  const len = await page.$('input[aria-label="Module parameter len"]');
  await len.focus(); await len.evaluate(e=>e.select()); await page.keyboard.type("18"); await page.keyboard.press("Tab");
  await click("Insert module");
  await exact();
  await click("Fit all");
  await frame();
  await shot("module-library");
  await page.waitForFunction(() => document.querySelector("footer")?.textContent.includes("Saved locally"));
  await Promise.all([page.waitForNavigation(),page.click('a[href="?"]')]);
  await page.waitForSelector(".monaco-editor .view-lines", {timeout:45000});
  await page.waitForFunction(() => document.querySelector("model-viewer.main-viewer")?.loaded && Number(getComputedStyle(document.querySelector("model-viewer.main-viewer")).opacity) >= 0.99, {timeout:90000});
  await frame();
  await shot("authored-module-code");
  console.log("Captured three module library screenshots.");
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
