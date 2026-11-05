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
  test("unchanged native meshes and mechanical parameters survive both workspace links", async () => {
    const file = path.resolve("examples/forma3d/imported-mesh.forma3d");
    await (await page.$('input[aria-label="Project file"]')).uploadFile(file);
    await page.waitForSelector('button[aria-label="Select Imported cube"]');
    const before = await native();
    const code = await toCode();
    expect(code).toContain('import("meshes/');
    await page.waitForFunction(
      () => document.querySelector("model-viewer.main-viewer")?.src,
    );
    await toVisual();
    const after = await native();
    expect(after.bodies.map((b) => b.id)).toEqual(
      before.bodies.map((b) => b.id),
    );
    expect(after.features).toEqual(before.features);
    expect(after.meshAssets).toEqual(before.meshAssets);
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      874.53806234,
      2,
    );
  }, 150000);
  test("complex SCAD retains editable source through visual transforms and native save/open", async () => {
    await click("＋ box");
    await toCode();
    const custom =
      "// custom stepped shape\nmodule step(w){cube([w,10,5]);}\nfor(i=[0:2]) translate([i*15,0,0]) step(10);";
    await edit(custom);
    await toVisual();
    await page.click('button[aria-label="Select SCAD model"]');
    await page.waitForSelector('section[aria-label="Linked SCAD source"]');
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      1500,
      2,
    );
    await numeric("position X", 7);
    const p = await native();
    expect(
      p.bodies[0].codeProject.files.some((f) => f.content?.includes(custom)),
    ).toBe(true);
    fs.writeFileSync(
      path.join(temp, "source.forma3d"),
      await download("Save project"),
    );
    page.once("dialog", (d) => d.accept());
    await click("New");
    await (
      await page.$('input[aria-label="Project file"]')
    ).uploadFile(path.join(temp, "source.forma3d"));
    await page.waitForSelector('button[aria-label="Select SCAD model"]');
    await page.click('button[aria-label="Select SCAD model"]');
    const code = await toCode();
    expect(code).toContain("include </");
    expect(code).toContain("translate([7,0,0])");
    await page.waitForFunction(
      () =>
        document.querySelector("model-viewer.main-viewer")?.src ||
        window.monaco.editor.getModelMarkers({}).some((m) => m.severity === 8),
    );
    expect(
      await page.evaluate(() =>
        window.monaco.editor
          .getModelMarkers({})
          .filter((m) => m.severity === 8)
          .map((m) => m.message),
      ),
    ).toEqual([]);
    await toVisual();
    expect(mesh(await download("Export exact STL")).min[0]).toBe(7);
  }, 180000);
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
  test("included source files, customizer values and default curve tessellation survive visual wrapping", async () => {
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
    const state = {
      params: {
        activePath: "/model.scad",
        sources: [
          {
            path: "/model.scad",
            content:
              "use </parts/piece.scad>\nwidth=10;\nfor(i=[0:1]) translate([i*30,0,0]) piece(width);",
          },
          {
            path: "/parts/piece.scad",
            content: "module piece(w){cylinder(r=w/2,h=10);}",
          },
        ],
        vars: { width: 12 },
        features: [],
        exportFormat2D: "svg",
        exportFormat3D: "stl",
      },
      view: {
        layout: {
          mode: "multi",
          editor: true,
          viewer: true,
          customizer: false,
        },
        color: "#f9d72c",
      },
    };
    await page.goto(`${base}#${encodeURIComponent(JSON.stringify(state))}`);
    expect(await source()).toContain("use </parts/piece.scad>");
    await toVisual();
    await page.click('button[aria-label="Select SCAD model"]');
    const before = mesh(await download("Export exact STL"));
    await numeric("position X", 3);
    const code = await toCode();
    await page.waitForFunction(
      () => document.querySelector("model-viewer.main-viewer")?.src,
      { timeout: 60000 },
    );
    await edit(code + "\n// Rebuild this wrapped source\n");
    await toVisual();
    const after = mesh(await download("Export exact STL"));
    expect(after.volume).toBeCloseTo(before.volume, 3);
    expect(after.min[0]).toBeCloseTo(before.min[0] + 3, 4);
    const p = await native();
    expect(
      p.bodies[0].codeProject.files.some((f) => f.path === "/parts/piece.scad"),
    ).toBe(true);
  }, 180000);
});
