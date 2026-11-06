const fs = require("fs"),
  path = require("path"),
  os = require("os");
const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const click = (label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === label,
    );
    if (!b) throw Error(label);
    b.click();
  }, label);
async function numeric(label, value) {
  const input = await page.waitForSelector(`input[aria-label="${label}"]`);
  await input.focus();
  await input.evaluate((e) => e.select());
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
}
async function source(target = page) {
  await target.bringToFront();
  await target.waitForSelector(".monaco-editor .view-lines", {
    timeout: 45000,
  });
  await target.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return target.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
}
async function edit(text, target = page) {
  await source(target);
  await target.bringToFront();
  await target.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await target.keyboard.down("Control");
  await target.keyboard.press("A");
  await target.keyboard.up("Control");
  await target.keyboard.sendCharacter(text);
  await target.waitForFunction(
    async (text) => {
      const id = new URLSearchParams(location.search).get("workspace");
      if (!id) return true;
      return new Promise((resolve) => {
        const r = indexedDB.open("forma3d-studio", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db
              .transaction("projects")
              .objectStore("projects")
              .get("workspace:" + id);
          q.onsuccess = () => {
            const p = q.result?.code?.params;
            resolve(
              p?.sources.find((f) => f.path === p.activePath)?.content ===
                text ||
                document.body.textContent.includes("Shared code save failed"),
            );
            db.close();
          };
        };
      });
    },
    { timeout: 20000 },
    text,
  );
  await target.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
async function toCode() {
  await page.waitForFunction(() =>
    document.querySelector("footer")?.textContent.includes("Saved locally"),
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.click('a[href="?"]'),
  ]);
  return source();
}
async function toVisual() {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load", timeout: 90000 }),
    page.click('a[href="?studio=1"]'),
  ]);
  // The classic editor also updates its hash asynchronously. Wait for the
  // actual route handoff, rather than mistaking that hash update for it.
  await page.waitForFunction(
    () => new URLSearchParams(location.search).get("studio") === "1",
  );
  await page.waitForFunction(
    () => document.querySelector("button")?.disabled === false,
  );
}
async function download(label) {
  await page.evaluate(() => {
    window.linkDownload = undefined;
    HTMLAnchorElement.prototype.click = function () {
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.linkDownload = Array.from(new Uint8Array(b))));
    };
  });
  await click(label);
  await page.waitForFunction(() => window.linkDownload?.length > 0, {
    timeout: 60000,
  });
  return Buffer.from(await page.evaluate(() => window.linkDownload));
}
async function native() {
  const zip = await require("jszip").loadAsync(await download("Save project"));
  return JSON.parse(await zip.file("project.json").async("string"));
}
function mesh(buffer) {
  const n = buffer.readUInt32LE(80),
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  expect(buffer.length).toBe(84 + n * 50);
  for (let i = 0; i < n; i++) {
    const p = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((a) => buffer.readFloatLE(96 + i * 50 + v * 12 + a * 4)),
    );
    for (const v of p)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], v[a]);
        max[a] = Math.max(max[a], v[a]);
      }
    const [a, b, c] = p;
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return { size: max.map((n, i) => n - min[i]), min, volume: Math.abs(volume) };
}
let temp;
describe("Linked visual and Code workspaces", () => {
  beforeAll(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-workspace-"));
  });
  afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
  beforeEach(async () => {
    await page.setViewport({ width: 1600, height: 1100 });
    await page.goto(`${base}?studio=1`);
    await page.waitForFunction(
      () => document.querySelector("button")?.disabled === false,
    );
    page.once("dialog", (d) => d.accept());
    await click("New");
  }, 15000);
  afterEach(async () => {
    if (new URL(page.url()).searchParams.has("studio"))
      await page.waitForFunction(() =>
        document.querySelector("footer")?.textContent.includes("Saved locally"),
      );
  }, 15000);
  test("visual body edits enter Code, source edits return as native nodes with stable IDs, and reload keeps linked source", async () => {
    await click("＋ box");
    await numeric("Width (mm)", 40);
    await numeric("Depth (mm)", 30);
    const original = await native();
    const code = await toCode();
    expect(code).toContain("cube([40,30,20]");
    expect(code).not.toMatch(/\bmodule\b|\bn\d+\s*\(/);
    expect(new URL(page.url()).searchParams.has("workspace")).toBe(true);
    await edit(code.replace("cube([40,30,20]", "cube([60,30,20]"));
    await page.reload();
    const changed = await source();
    expect(changed).toContain("cube([60,30,20]");
    await toVisual();
    const p = await native();
    expect(p.bodies[0].id).toBe(original.bodies[0].id);
    expect(p.bodies[0].kind).toBe("box");
    expect(p.bodies[0].size).toEqual([60, 30, 20]);
    expect(mesh(await download("Export exact STL")).size).toEqual([60, 30, 20]);
    await click("Undo");
    expect((await native()).bodies[0].size).toEqual([40, 30, 20]);
    await click("Redo");
    await page.click('button[aria-label="Select Box"]');
    await numeric("position X", 12);
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("button")?.disabled === false,
    );
    expect((await native()).bodies[0].position[0]).toBe(12);
    const again = await toCode();
    expect(again).toContain("translate([12,0,10])");
    await toVisual();
    expect((await native()).bodies[0].position[0]).toBe(12);
  }, 150000);
  test("imported meshes block Code even as hidden or consumed operands, and deleting them restores access", async () => {
    await (
      await page.$('input[aria-label="Project file"]')
    ).uploadFile(path.resolve("examples/forma3d/imported-mesh.forma3d"));
    await page.waitForSelector('button[aria-label="Select Imported cube"]');
    const before = await native();
    const link = 'header a[role="link"]';
    expect(await page.$eval(link, (e) => e.getAttribute("aria-disabled"))).toBe(
      "true",
    );
    expect(await page.$eval(link, (e) => e.getAttribute("href"))).toBeNull();
    await page.click(link);
    await page.waitForFunction(() =>
      document
        .querySelector("footer")
        ?.textContent.includes("Code workspace unavailable"),
    );
    expect(new URL(page.url()).searchParams.get("studio")).toBe("1");
    expect((await native()).features).toEqual(before.features);
    await page.click('button[aria-label="Toggle visibility Imported cube"]');
    expect(await page.$eval(link, (e) => e.getAttribute("aria-disabled"))).toBe(
      "true",
    );
    await page.click(`button[aria-label="Select ${before.features[0].name}"]`);
    await click("Remove boolean");
    await page.click('button[aria-label="Select Imported cube"]');
    await click("Delete");
    expect(await page.$eval(link, (e) => e.getAttribute("aria-disabled"))).toBe(
      "false",
    );
    const code = await toCode();
    expect(code).toContain("cylinder(");
    expect(code).not.toMatch(/\bmodule\b|\bimport\s*\(/);
  }, 90000);
  test("unsupported code remains editable in Code instead of becoming an opaque mesh", async () => {
    await click("＋ box");
    await toCode();
    const custom =
      "module step(w){cube([w,10,5]);} for(i=[0:2]) translate([i*15,0,0]) step(10);";
    await edit(custom);
    await page.click('a[href="?studio=1"]');
    await page.waitForFunction(() =>
      document.body.textContent.includes(
        "cannot yet be edited as native visual shapes",
      ),
    );
    expect(new URL(page.url()).searchParams.has("studio")).toBe(false);
    expect(await source()).toBe(custom);
  }, 90000);
  test("invalid code cannot overwrite the visual design, and a corrected source can still switch", async () => {
    await click("＋ box");
    const original = await native(),
      code = await toCode();
    await edit("this is invalid SCAD;");
    await page.click('a[href="?studio=1"]');
    await page.waitForFunction(
      () => document.body.textContent.includes("Workspace switch failed"),
      { timeout: 90000 },
    );
    expect(new URL(page.url()).searchParams.has("studio")).toBe(false);
    expect(await source()).toBe("this is invalid SCAD;");
    await edit(code);
    await toVisual();
    expect((await native()).bodies[0].id).toBe(original.bodies[0].id);
  }, 150000);
  test("classic Code designs switch into native Visual Design instead of unrelated saved geometry", async () => {
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Saved locally"),
    );
    await page.goto(
      `${base}#src=${encodeURIComponent("width=35;cube([width,20,10]);")}`,
    );
    await source();
    await toVisual();
    const p = await native();
    expect(p.bodies).toHaveLength(1);
    expect(p.bodies[0].kind).toBe("box");
    expect(p.bodies[0].size).toEqual([35, 20, 10]);
    expect(mesh(await download("Export exact STL")).size).toEqual([35, 20, 10]);
  }, 150000);
  test("a stale second Code tab cannot silently overwrite the newer shared design", async () => {
    await click("＋ box");
    const original = await toCode(),
      second = await browser.newPage();
    try {
      await second.goto(page.url());
      await source(second);
      await edit(original.replace("cube([20,20,20]", "cube([30,20,20]"));
      await edit(
        original.replace("cube([20,20,20]", "cube([70,20,20]"),
        second,
      );
      await second.waitForFunction(() =>
        document.body.textContent.includes("Shared code save failed"),
      );
      expect(await source(second)).toContain("cube([70,20,20]");
      await page.bringToFront();
      await toVisual();
      expect((await native()).bodies[0].size[0]).toBe(30);
    } finally {
      await second.close();
    }
  }, 150000);
  test("native patterns expose direct for/translate/cube code without generated modules", async () => {
    await click("＋ box");
    await numeric("Width (mm)", 10);
    await numeric("Depth (mm)", 10);
    await numeric("Height (mm)", 10);
    await numeric("position X", 30);
    await numeric("position Z", 5);
    await page.click(".studio-modeling summary");
    await click("Circular pattern");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".studio-legend")].some((e) =>
          e.textContent.includes("Exact geometry up to date"),
        ),
      { timeout: 60000 },
    );
    const before = await native(),
      volume = mesh(await download("Export exact STL")).volume;
    const code = await toCode();
    expect(code).toContain("for(i=");
    expect(code).toContain("rotate(");
    expect(code).toContain("cube([10,10,10]");
    expect(code).not.toMatch(/\bmodule\b|\bn\d+\s*\(/);
    await page.waitForFunction(
      () => document.querySelector("model-viewer.main-viewer")?.loaded,
      { timeout: 60000 },
    );
    expect(mesh(await download("Download STL")).volume).toBeCloseTo(volume, 3);
    await toVisual();
    const after = await native();
    expect(after.features).toEqual(before.features);
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      volume,
      3,
    );
  }, 120000);
  test("direct curved primitives retain exact scaled/rotated geometry and real dimensions in Code", async () => {
    await click("＋ cylinder");
    await numeric("Diameter (mm)", 20);
    await numeric("Depth (mm)", 10);
    await numeric("Height (mm)", 12);
    await numeric("rotation Z", 30);
    await numeric("scale X", 1.5);
    const expected = mesh(await download("Export exact STL"));
    const code = await toCode();
    expect(code).toContain("cylinder(h=12, d=20, center=true)");
    expect(code).not.toContain("module ");
    await page.waitForFunction(
      () => document.querySelector("model-viewer.main-viewer")?.loaded,
      { timeout: 60000 },
    );
    const actual = mesh(await download("Download STL"));
    expect(actual.volume).toBeCloseTo(expected.volume, 2);
    actual.size.forEach((v, i) => expect(v).toBeCloseTo(expected.size[i], 4));
  }, 90000);
  test("older generated-module workspaces reopen with direct native expressions", async () => {
    await click("＋ box");
    await toCode();
    const old =
      "$fn=64;\nmodule n0() { translate([0,0,10]) rotate([0,0,0]) scale([1,1,1]) cube([20,20,20], center=true); }\nn0();\n";
    await page.evaluate(
      (old) =>
        new Promise((resolve, reject) => {
          const q = indexedDB.open("forma3d-studio", 1);
          q.onsuccess = () => {
            const db = q.result,
              tx = db.transaction("projects", "readwrite"),
              store = tx.objectStore("projects"),
              key =
                "workspace:" +
                new URLSearchParams(location.search).get("workspace"),
              r = store.get(key);
            r.onsuccess = () => {
              const w = r.result;
              w.code.params.sources[0].content = old;
              w.baseline = structuredClone(w.code);
              w.revision++;
              store.put(w, key);
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      old,
    );
    await page.reload();
    expect(await source()).toContain("module n0()");
    await toVisual();
    const direct = await toCode();
    expect(direct).toContain("cube([20,20,20]");
    expect(direct).not.toMatch(/\bmodule\b|\bn\d+\s*\(/);
  }, 90000);
});
