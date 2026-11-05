const fs = require("fs"),
  path = require("path"),
  os = require("os"),
  { execFileSync } = require("child_process");
const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const click = (label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === label,
    );
    if (!b) throw Error(label);
    b.click();
  }, label);
const frame = () =>
  page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
async function numeric(label, value) {
  const el = await page.waitForSelector(`input[aria-label="${label}"]`);
  await el.focus();
  await el.evaluate((el) => el.select());
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
}
async function ready() {
  await frame();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".studio-legend")].some((el) =>
        el.textContent.includes("Exact geometry up to date"),
      ),
    { timeout: 60000 },
  );
}
async function download(label) {
  await page.evaluate(() => {
    window.meshDownload = undefined;
    HTMLAnchorElement.prototype.click = function () {
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.meshDownload = Array.from(new Uint8Array(b))));
    };
  });
  await click(label);
  await page.waitForFunction(() => window.meshDownload?.length > 0, {
    timeout: 60000,
  });
  return Buffer.from(await page.evaluate(() => window.meshDownload));
}
async function project() {
  const zip = await require("jszip").loadAsync(await download("Save project"));
  return JSON.parse(await zip.file("project.json").async("string"));
}
function stl(buffer) {
  const n = buffer.readUInt32LE(80),
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  expect(buffer.length).toBe(84 + n * 50);
  let volume = 0;
  for (let i = 0; i < n; i++) {
    const p = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((a) => buffer.readFloatLE(96 + i * 50 + v * 12 + a * 4)),
    );
    p.forEach((v) =>
      v.forEach((n, a) => {
        expect(Number.isFinite(n)).toBe(true);
        min[a] = Math.min(min[a], n);
        max[a] = Math.max(max[a], n);
      }),
    );
    const [a, b, c] = p;
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return {
    min,
    max,
    size: max.map((n, i) => n - min[i]),
    volume: Math.abs(volume),
  };
}
let fixtures;
async function selectFile(name, units = "mm", placement = "plate") {
  await page.$eval(".studio-mesh-import", (el) => (el.open = true));
  await (
    await page.$('input[aria-label="Mesh file"]')
  ).uploadFile(path.join(fixtures, name));
  await page.select('select[aria-label="Mesh import units"]', units);
  await page.select('select[aria-label="Mesh import placement"]', placement);
  await page.click('input[aria-label="Confirm mesh import units"]');
}
async function importFile(name, units = "mm", placement = "plate") {
  await selectFile(name, units, placement);
  await click("Import mesh");
  await page.waitForSelector(
    'section[aria-label="Imported mesh diagnostics"]',
    { timeout: 45000 },
  );
  await page.waitForFunction(() =>
    document.querySelector("footer").textContent.includes("Mesh imported"),
  );
}
describe("Mesh import workflows", () => {
  beforeAll(() => {
    fixtures = fs.mkdtempSync(path.join(os.tmpdir(), "forma-mesh-browser-"));
    execFileSync(
      process.execPath,
      [
        "--import",
        "./server/node_modules/tsx/dist/loader.mjs",
        "tests/write-mesh-fixtures.ts",
        fixtures,
      ],
      { cwd: process.cwd() },
    );
  }, 15000);
  afterAll(() => fs.rmSync(fixtures, { recursive: true, force: true }));
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
    await frame();
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
  }, 15000);
  test("unit confirmation, transformed STL, native asset roundtrip, recovery and portable SCAD bundle", async () => {
    await page.$eval(".studio-mesh-import", (el) => (el.open = true));
    await (
      await page.$('input[aria-label="Mesh file"]')
    ).uploadFile(path.join(fixtures, "cube.stl"));
    expect(
      await page.$eval(".studio-mesh-import button", (el) => el.disabled),
    ).toBe(true);
    await page.select('select[aria-label="Mesh import units"]', "cm");
    await page.click('input[aria-label="Confirm mesh import units"]');
    await click("Import mesh");
    await page.waitForSelector(
      'section[aria-label="Imported mesh diagnostics"]',
    );
    await numeric("scale X", 2);
    await numeric("rotation Z", 90);
    await numeric("position X", 15);
    await numeric("position Y", -100);
    const r = stl(await download("Export exact STL"));
    expect(r.size).toEqual([100, 200, 100]);
    expect(r.min).toEqual([-85, -100, 0]);
    expect(r.volume).toBeCloseTo(2000000, 1);
    const p = await project();
    expect(p.version).toBe(6);
    expect(p.bodies[0].meshSource.units).toBe("cm");
    expect(p.meshAssets).toHaveLength(1);
    expect(p.meshAssets[0].data).toBeUndefined();
    const native = await download("Save project"),
      zip = await require("jszip").loadAsync(native),
      manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    expect(manifest.version).toBe(2);
    expect(zip.file(`meshes/${p.bodies[0].meshAssetId}.stl`)).not.toBeNull();
    await click("Generated SCAD");
    const bundle = await require("jszip").loadAsync(
      await download("Download SCAD"),
    );
    expect(await bundle.file("design.scad").async("string")).toContain(
      `import("meshes/${p.bodies[0].meshAssetId}.stl"`,
    );
    expect(bundle.file(`meshes/${p.bodies[0].meshAssetId}.stl`)).not.toBeNull();
    fs.writeFileSync(path.join(fixtures, "roundtrip.forma3d"), native);
    page.once("dialog", (d) => d.accept());
    await click("New");
    await (
      await page.$('input[aria-label="Project file"]')
    ).uploadFile(path.join(fixtures, "roundtrip.forma3d"));
    await page.waitForSelector('button[aria-label="Select cube.stl"]');
    await page.click('button[aria-label="Select cube.stl"]');
    expect((await project()).bodies[0].id).toBe(p.bodies[0].id);
    expect(stl(await download("Export exact STL")).size).toEqual([
      100, 200, 100,
    ]);
    await frame();
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Saved locally"),
    );
    await page.reload();
    await page.waitForSelector('button[aria-label="Select cube.stl"]');
    expect((await project()).bodies[0].meshAssetId).toBe(
      p.bodies[0].meshAssetId,
    );
  }, 120000);
  test("imported mesh participates in editable booleans with source data preserved", async () => {
    await importFile("cube.stl");
    await click("＋ cylinder");
    await numeric("Diameter (mm)", 4);
    await numeric("position Z", 5);
    await click("Difference");
    await ready();
    let r = stl(await download("Export exact STL"));
    const factor = (64 * Math.sin((2 * Math.PI) / 64)) / 2;
    expect(r.size).toEqual([10, 10, 10]);
    expect(r.volume).toBeCloseTo(1000 - factor * 4 * 10, 2);
    const p = await project();
    await page.click('button[aria-label="Select cube.stl"]');
    await numeric("scale X", 2);
    await ready();
    r = stl(await download("Export exact STL"));
    expect(r.size).toEqual([20, 10, 10]);
    expect(r.volume).toBeCloseTo(2000 - factor * 4 * 10, 2);
    expect((await project()).bodies[0].meshAssetId).toBe(
      p.bodies[0].meshAssetId,
    );
    await click("Undo");
    await ready();
    expect(stl(await download("Export exact STL")).volume).toBeCloseTo(
      1000 - factor * 4 * 10,
      2,
    );
  }, 120000);
  test.each(["ascii.stl", "cube.obj", "cube.3mf", "cube.glb", "cube.gltf"])(
    "%s imports real geometry and exports with correct dimensions",
    async (name) => {
      await importFile(name, /\.(3mf|glb|gltf)$/.test(name) ? "file" : "mm");
      const r = stl(await download("Export exact STL"));
      r.size.forEach((n) => expect(n).toBeCloseTo(10, 4));
      expect(r.volume).toBeCloseTo(1000, 1);
    },
    90000,
  );
  test("open meshes remain visible and savable while invalid files and unsupported solid operations preserve the document", async () => {
    await importFile("open.stl");
    expect(
      await page.$eval(
        'section[aria-label="Imported mesh diagnostics"]',
        (el) => el.textContent,
      ),
    ).toContain("Topology defects");
    const p = await project();
    expect(p.bodies).toHaveLength(1);
    await click("Export exact STL");
    await page.waitForFunction(() =>
      document
        .querySelector("footer")
        .textContent.includes("closed imported mesh"),
    );
    await click("＋ box");
    await click("Union");
    await page.waitForFunction(() =>
      document
        .querySelector("footer")
        .textContent.includes("closed, consistently oriented"),
    );
    expect((await project()).features).toHaveLength(0);
    await selectFile("invalid.stl");
    await click("Import mesh");
    await page.waitForFunction(() =>
      document
        .querySelector("footer")
        .textContent.includes("Mesh import failed"),
    );
    expect((await project()).bodies).toHaveLength(2);
  }, 90000);
  test("canceling an import leaves history and stored geometry unchanged", async () => {
    await selectFile("cube.stl");
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Import mesh")
        .click();
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "Cancel import",
      ),
    );
    await click("Cancel import");
    await page.waitForFunction(() =>
      document
        .querySelector("footer")
        .textContent.includes("Mesh import failed"),
    );
    expect((await project()).bodies).toHaveLength(0);
    expect((await project()).meshAssets).toHaveLength(0);
  }, 60000);
});
