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
  await page.goto(`http://127.0.0.1:${server.address().port}/?studio=1`);
  await page.waitForFunction(
    () => document.querySelector("button")?.disabled === false,
  );
  const click = (label) =>
    page.evaluate(
      (label) =>
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === label)
          .click(),
      label,
    );
  const frame = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await click("＋ box");
  await frame();
  await page.screenshot({
    path: path.join(root, "docs/images/studio-overview.png"),
  });
  await page
    .$("input[type=file]")
    .then((input) =>
      input.uploadFile(
        path.join(root, "examples/forma3d/editable-hole.forma3d"),
      ),
    );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".studio-legend")].some((el) =>
        el.textContent.includes("Exact geometry up to date"),
      ),
    { timeout: 60000 },
  );
  await click("Fit all");
  await page.click('button[aria-label="Select Difference"]');
  await frame();
  await page.screenshot({
    path: path.join(root, "docs/images/editable-boolean.png"),
  });
  await page.click(".studio-print summary");
  await click("Analyze exact mesh");
  await page.waitForSelector('section[aria-label="Mesh analysis results"]', {
    timeout: 60000,
  });
  await page.$eval('section[aria-label="Mesh analysis results"]', (el) =>
    el.scrollIntoView({ block: "center" }),
  );
  await frame();
  await page.screenshot({
    path: path.join(root, "docs/images/mesh-analysis.png"),
  });
  await click("Sketch & extrude");
  await page.waitForSelector(".studio-sketch-editor");
  for (const [label, value] of [
    ["Sketch width (mm)", 40],
    ["Sketch depth (mm)", 30],
    ["Extrusion height (mm)", 12],
  ]) {
    const input = await page.$(
      `.studio-sketch-editor input[aria-label="${label}"]`,
    );
    await input.focus();
    await input.evaluate((el) => el.select());
    await page.keyboard.type(String(value));
    await page.keyboard.press("Enter");
  }
  await click("Fit profile");
  await frame();
  await page.screenshot({
    path: path.join(root, "docs/images/sketch-editor.png"),
  });
  await click("Cancel sketch");
  console.log("Captured four real application screenshots in docs/images");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
