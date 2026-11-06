// Run after npm run build. Screenshots use the real application and WASM worker.
import fs from "node:fs";
import assert from "node:assert/strict";
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
  if (!process.argv.includes("--tutorial-only")) {
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
    await page
      .$("input[type=file]")
      .then((input) =>
        input.uploadFile(
          path.join(root, "examples/forma3d/parametric-enclosure.forma3d"),
        ),
      );
    await page.waitForFunction(() =>
      document.querySelector('button[aria-label="Select Enclosure"]'),
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".studio-legend")].some((el) =>
          el.textContent.includes("Exact geometry up to date"),
        ),
      { timeout: 60000 },
    );
    await page.click('button[aria-label="Select Enclosure"]');
    await click("Fit all");
    await frame();
    // Orbit the actual viewport to reveal all four mounting posts above the walls.
    const enclosureCanvas = await (await page.$("canvas")).boundingBox();
    const orbitX = enclosureCanvas.x + enclosureCanvas.width * 0.85;
    const orbitY = enclosureCanvas.y + enclosureCanvas.height * 0.15;
    await page.mouse.move(orbitX, orbitY);
    await page.mouse.down();
    await page.mouse.move(orbitX, orbitY + enclosureCanvas.height * 0.13, {
      steps: 12,
    });
    await page.mouse.up();
    await frame();
    await page.screenshot({
      path: path.join(root, "docs/images/mechanical-enclosure.png"),
    });
    page.once("dialog", (d) => d.accept());
    await click("New");
    await click("＋ box");
    const number = async (label, value) => {
      const input = await page.$(`input[aria-label="${label}"]`);
      await input.focus();
      await input.evaluate((el) => el.select());
      await page.keyboard.type(String(value));
      await page.keyboard.press("Enter");
    };
    for (const label of ["Width (mm)", "Depth (mm)", "Height (mm)"])
      await number(label, 10);
    await number("position X", 30);
    await number("position Z", 5);
    await page.click(".studio-modeling summary");
    await click("Circular pattern");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".studio-legend")].some((el) =>
          el.textContent.includes("Exact geometry up to date"),
        ),
      { timeout: 60000 },
    );
    await click("Fit all");
    await frame();
    await page.screenshot({
      path: path.join(root, "docs/images/advanced-pattern.png"),
    });
    await page
      .$('input[aria-label="Project file"]')
      .then((input) =>
        input.uploadFile(
          path.join(root, "examples/forma3d/imported-mesh.forma3d"),
        ),
      );
    await page.waitForSelector('button[aria-label="Select Imported cube"]');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".studio-legend")].some((el) =>
          el.textContent.includes("Exact geometry up to date"),
        ),
      { timeout: 60000 },
    );
    await page.click('button[aria-label="Select Imported cube"]');
    await page.waitForSelector(
      'section[aria-label="Imported mesh diagnostics"]',
    );
    await page.$eval(".studio-modeling", (el) => (el.open = false));
    await page.$eval(".studio-mesh-import", (el) => (el.open = true));
    await click("Fit all");
    await frame();
    await page.$eval(".studio-mesh-import", (el) =>
      el.scrollIntoView({ block: "start" }),
    );
    await frame();
    await page.screenshot({
      path: path.join(root, "docs/images/imported-mesh.png"),
    });
    // Keep a real kernel export beside the native asset-backed example.
    await page.evaluate(() => {
      HTMLAnchorElement.prototype.click = function () {
        fetch(this.href)
          .then((r) => r.arrayBuffer())
          .then(
            (b) => (window.meshExampleDownload = Array.from(new Uint8Array(b))),
          );
      };
    });
    await click("Export exact STL");
    await page.waitForFunction(() => window.meshExampleDownload?.length > 0, {
      timeout: 60000,
    });
    fs.writeFileSync(
      path.join(root, "examples/forma3d/imported-mesh.stl"),
      Buffer.from(await page.evaluate(() => window.meshExampleDownload)),
    );
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
    page.once("dialog", (dialog) => dialog.accept());
    await click("New");
    await click("＋ box");
    for (const [label, value] of [
      ["Width (mm)", 60],
      ["Depth (mm)", 30],
    ]) {
      const input = await page.$(`input[aria-label="${label}"]`);
      await input.focus();
      await input.evaluate((e) => e.select());
      await page.keyboard.type(String(value));
      await page.keyboard.press("Enter");
    }
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
    await click("Fit all");
    await frame();
    await page.screenshot({
      path: path.join(root, "docs/images/studio-linked-visual.png"),
    });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.click('a[href="?"]'),
    ]);
    await page.waitForSelector(".monaco-editor .view-lines", {
      timeout: 45000,
    });
    await page.waitForFunction(
      () => document.querySelector("model-viewer.main-viewer")?.src,
      { timeout: 60000 },
    );
    await page.waitForFunction(
      () => document.querySelector("model-viewer.main-viewer")?.loaded,
      { timeout: 30000 },
    );
    await frame();
    await page.waitForFunction(
      () =>
        Number(
          getComputedStyle(document.querySelector("model-viewer.main-viewer"))
            .opacity,
        ) >= 0.99,
    );
    await frame();
    await page.screenshot({
      path: path.join(root, "docs/images/studio-linked-code.png"),
    });
    console.log(
      "Captured nine real application screenshots and the imported-mesh exact STL example",
    );
  }
  await captureFirstPart(page, click, frame);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

// The beginner walkthrough is built entirely through the visible controls.
async function captureFirstPart(page, click, frame) {
  if (new URL(page.url()).searchParams.get("studio") !== "1")
    await page.goto(`http://127.0.0.1:${server.address().port}/?studio=1`);
  await page.waitForFunction(
    () => document.querySelector("button")?.disabled === false,
  );
  page.once("dialog", (d) => d.accept());
  await click("New");
  await click("＋ box");
  const number = async (label, value) => {
    const input = await page.$(`input[aria-label="${label}"]`);
    await input.focus();
    await input.evaluate((e) => e.select());
    await page.keyboard.type(String(value));
    await page.keyboard.press("Enter");
  };
  for (const [label, value] of [
    ["Width (mm)", 60],
    ["Depth (mm)", 40],
    ["Height (mm)", 6],
    ["position Z", 3],
  ])
    await number(label, value);
  await click("Fit all");
  await frame();
  await page.waitForFunction(() =>
    document.querySelector("footer")?.textContent.includes("Saved locally"),
  );
  await page.screenshot({
    path: path.join(root, "docs/images/first-part-plate.png"),
  });
  await click("＋ cylinder");
  for (const [label, value] of [
    ["Diameter (mm)", 8],
    ["Height (mm)", 12],
    ["position Z", 3],
  ])
    await number(label, value);
  for (const [label, name] of [
    ["Boolean base", "Box"],
    ["Boolean tool", "Cylinder"],
  ]) {
    const value = await page.$eval(
      `select[aria-label="${label}"]`,
      (e, name) => [...e.options].find((o) => o.textContent === name).value,
      name,
    );
    await page.select(`select[aria-label="${label}"]`, value);
  }
  await click("Difference");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".studio-legend")].some((e) =>
        e.textContent.includes("Exact geometry up to date"),
      ),
    { timeout: 60000 },
  );
  await click("Fit all");
  await frame();
  await page.screenshot({
    path: path.join(root, "docs/images/first-part-hole.png"),
  });
  const download = async (label) => {
    await page.evaluate(() => {
      window.guideDownload = undefined;
      HTMLAnchorElement.prototype.click = function () {
        fetch(this.href)
          .then((r) => r.arrayBuffer())
          .then((b) => (window.guideDownload = Array.from(new Uint8Array(b))));
      };
    });
    await click(label);
    await page.waitForFunction(() => window.guideDownload?.length > 0, {
      timeout: 60000,
    });
    return Buffer.from(await page.evaluate(() => window.guideDownload));
  };
  const stl = await download("Export exact STL"),
    count = stl.readUInt32LE(80);
  assert.equal(stl.length, 84 + count * 50);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  for (let t = 0; t < count; t++) {
    const points = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((a) => stl.readFloatLE(96 + t * 50 + v * 12 + a * 4)),
    );
    for (const p of points)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p[a]);
        max[a] = Math.max(max[a], p[a]);
      }
    const [a, b, c] = points;
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  assert.deepEqual(min, [-30, -20, 0]);
  assert.deepEqual(max, [30, 20, 6]);
  const expected =
    60 * 40 * 6 - ((64 * 4 * 4 * Math.sin((2 * Math.PI) / 64)) / 2) * 6;
  assert.ok(
    Math.abs(Math.abs(volume) - expected) < 0.01,
    "Tutorial export must contain the centered 8 mm through-hole",
  );
  fs.writeFileSync(
    path.join(root, "examples/forma3d/first-part.forma3d"),
    await download("Save project"),
  );
  await page.waitForFunction(() =>
    document.querySelector("footer")?.textContent.includes("Saved locally"),
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.click('a[href="?"]'),
  ]);
  await page.waitForSelector(".monaco-editor .view-lines", { timeout: 45000 });
  await page.waitForFunction(
    () => document.querySelector("model-viewer.main-viewer")?.loaded,
    { timeout: 60000 },
  );
  await frame();
  await page.waitForFunction(
    () =>
      Number(
        getComputedStyle(document.querySelector("model-viewer.main-viewer"))
          .opacity,
      ) >= 0.99,
  );
  await frame();
  await page.screenshot({
    path: path.join(root, "docs/images/first-part-code.png"),
  });
  const original = await page.evaluate(() =>
    window.monaco.editor.getEditors()[0].getValue(),
  );
  assert.ok(original.includes("cube([60,40,6], center=true);"));
  const edited = original.replace("cube([60,40,6]", "cube([70,40,6]");
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.sendCharacter(edited);
  await frame();
  // Monaco may indent a pasted block; verify its actual text is durably saved.
  const inserted = await page.evaluate(() =>
    window.monaco.editor.getEditors()[0].getValue(),
  );
  assert.ok(inserted.includes("cube([70,40,6]"));
  await page.waitForFunction(
    (edited) =>
      new Promise((resolve) => {
        const q = indexedDB.open("forma3d-studio", 1);
        q.onsuccess = () => {
          const db = q.result,
            id = new URLSearchParams(location.search).get("workspace"),
            r = db
              .transaction("projects")
              .objectStore("projects")
              .get("workspace:" + id);
          r.onsuccess = () => {
            const p = r.result.code.params;
            resolve(
              p.sources.find((f) => f.path === p.activePath)?.content ===
                edited,
            );
            db.close();
          };
        };
      }),
    { timeout: 20000 },
    inserted,
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.click('a[href="?studio=1"]'),
  ]);
  await page.waitForFunction(
    () => document.querySelector("button")?.disabled === false,
  );
  await page.click('button[aria-label="Select Box"]');
  assert.equal(
    await page.$eval('input[aria-label="Width (mm)"]', (e) => Number(e.value)),
    70,
  );
  await click("Undo");
  assert.equal(
    await page.$eval('input[aria-label="Width (mm)"]', (e) => Number(e.value)),
    60,
  );
  console.log(
    `Captured three beginner walkthrough screenshots; verified ${count} exact STL triangles, 60 × 40 × 6 mm bounds, through-hole volume, Code width edit and visual Undo.`,
  );
}
