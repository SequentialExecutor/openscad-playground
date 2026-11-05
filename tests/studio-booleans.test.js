const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const click = (text) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    if (!b) throw Error(text);
    b.click();
  }, text);
async function numeric(label, n) {
  const el = await page.$(`input[aria-label="${label}"]`);
  await el.focus();
  await el.evaluate((el) => el.select());
  await page.keyboard.type(String(n));
  await page.keyboard.press("Enter");
}
async function download(button) {
  await page.evaluate(() => {
    window.meshDownload = undefined;
    HTMLAnchorElement.prototype.click = function () {
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.meshDownload = Array.from(new Uint8Array(b))));
    };
  });
  await click(button);
  await page.waitForFunction(() => window.meshDownload?.length > 0, {
    timeout: 60000,
  });
  return Buffer.from(await page.evaluate(() => window.meshDownload));
}
function meshInfo(buffer) {
  const count = buffer.readUInt32LE(80);
  expect(buffer.length).toBe(84 + 50 * count);
  expect(count).toBeGreaterThan(0);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let signed = 0,
    radius = Infinity;
  const triangles = [];
  for (let t = 0; t < count; t++) {
    const p = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((a) =>
        buffer.readFloatLE(84 + 50 * t + 12 + v * 12 + a * 4),
      ),
    );
    p.forEach((v) =>
      v.forEach((n, a) => {
        expect(Number.isFinite(n)).toBe(true);
        min[a] = Math.min(min[a], n);
        max[a] = Math.max(max[a], n);
      }),
    );
    for (const v of p) radius = Math.min(radius, Math.hypot(v[0], v[1]));
    const [a, b, c] = p;
    signed +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    triangles.push(p);
  }
  // Ray parallel to Z through (x,y), counting triangles with the point strictly inside their XY projection.
  const crossings = (x, y) =>
    triangles.filter(([a, b, c]) => {
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-7) return false;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
      return u > 1e-7 && v > 1e-7 && u + v < 1 - 1e-7;
    }).length;
  return { min, max, volume: Math.abs(signed), radius, crossings };
}
async function exactReady() {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".studio-legend")].some((el) =>
        el.textContent.includes("Exact geometry up to date"),
      ),
    { timeout: 60000 },
  );
}

async function nativeProject() {
  const bytes = await download("Save project");
  require("fs").writeFileSync("/tmp/forma-native-example.forma3d", bytes);
  const zip = await require("jszip").loadAsync(bytes, { checkCRC32: true });
  return JSON.parse(await zip.file("project.json").async("string"));
}
describe("Editable boolean geometry", () => {
  beforeEach(async () => {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${base}?studio=1`);
    await page.waitForFunction(
      () => document.querySelector("button")?.disabled === false,
    );
    page.once("dialog", (d) => d.accept());
    await click("New");
  });
  afterEach(async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
  });
  test("a cube hole stays editable, recomputes diameter, undoes and reloads with real cut geometry", async () => {
    await click("＋ box");
    await numeric("Width (mm)", 50);
    await numeric("Depth (mm)", 50);
    await numeric("Height (mm)", 50);
    await numeric("position Z", 25);
    await click("＋ cylinder");
    await numeric("Diameter (mm)", 10);
    await numeric("Height (mm)", 60);
    await numeric("position Z", 25);
    await click("Difference");
    await exactReady();
    const initialMesh = await download("Export exact STL");
    require("fs").writeFileSync("/tmp/forma-hole-example.stl", initialMesh);
    const first = meshInfo(initialMesh);
    expect(first.min).toEqual([-25, -25, 0]);
    expect(first.max).toEqual([25, 25, 50]);
    expect(first.radius).toBeCloseTo(5, 4);
    const area = (r) => (64 * r * r * Math.sin((2 * Math.PI) / 64)) / 2;
    expect(first.volume).toBeCloseTo(125000 - area(5) * 50, 1);
    expect(first.crossings(0.137, 0.219)).toBe(0);
    expect(first.crossings(15.137, 0.219)).toBe(2);
    await page.click(".studio-print summary");
    await click("Analyze exact mesh");
    await page.waitForSelector('section[aria-label="Mesh analysis results"]');
    expect(
      await page.$eval(
        'section[aria-label="Mesh analysis results"]',
        (el) => el.textContent,
      ),
    ).toContain("Closed consistently oriented edge topology");
    const analyzedVolume = Number(
      await page.$eval(
        'section[aria-label="Mesh analysis results"]',
        (el) =>
          [...el.querySelectorAll("dt")].find(
            (dt) => dt.textContent === "Volume (mm³)",
          ).nextElementSibling.textContent,
      ),
    );
    expect(analyzedVolume).toBeCloseTo(first.volume, 1);
    await numeric("Build X (mm)", 10);
    await click("Analyze exact mesh");
    await page.waitForFunction(() =>
      document
        .querySelector('section[aria-label="Mesh analysis results"]')
        ?.textContent.includes("exceeds the centered"),
    );
    await numeric("Build X (mm)", 220);

    await page.click('button[aria-label="Select Cylinder"]');
    await numeric("Diameter (mm)", 15);
    await exactReady();
    const wider = meshInfo(await download("Export exact STL"));
    expect(wider.radius).toBeCloseTo(7.5, 4);
    expect(wider.volume).toBeCloseTo(125000 - area(7.5) * 50, 1);
    await click("Undo");
    await exactReady();
    expect(meshInfo(await download("Export exact STL")).radius).toBeCloseTo(
      5,
      4,
    );
    const project = await nativeProject();
    expect(project.features[0].operation).toBe("difference");
    expect(project.bodies).toHaveLength(2);
    require("fs").writeFileSync(
      "/tmp/forma-hole-example.json",
      JSON.stringify(project, null, 2),
    );
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Saved locally"),
    );
    await page.reload();
    await exactReady();
    const restored = await nativeProject();
    expect(restored.features[0].inputs).toEqual(project.features[0].inputs);
    expect(meshInfo(await download("Export exact STL")).volume).toBeCloseTo(
      first.volume,
      1,
    );
    await page.click('button[aria-label="Select Cylinder"]');
    await numeric("position X", 1);
  }, 120000);
  test("union and intersection use exact volume; empty results report errors without destroying operands", async () => {
    await click("＋ box");
    await click("Duplicate");
    await numeric("position X", 10);
    await click("Union");
    await exactReady();
    expect(meshInfo(await download("Export exact STL")).volume).toBeCloseTo(
      12000,
      1,
    );
    await page.select('select[aria-label="Feature operation"]', "intersection");
    await exactReady();
    expect(meshInfo(await download("Export exact STL")).volume).toBeCloseTo(
      4000,
      1,
    );
    await page.click('button[aria-label="Select Box copy"]');
    await numeric("position X", 100);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".studio-legend")].some((el) =>
          el.textContent.includes("Geometry evaluation failed"),
        ),
      { timeout: 60000 },
    );
    const project = await nativeProject();
    expect(project.bodies).toHaveLength(2);
    expect(project.features).toHaveLength(1);
    await page.evaluate(() => {
      window.meshDownload = undefined;
    });
    await click("Export exact STL");
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Export failed"),
    );
    expect(await page.evaluate(() => window.meshDownload)).toBeUndefined();
    await numeric("position X", 10);
    await exactReady();
    expect(meshInfo(await download("Export exact STL")).volume).toBeCloseTo(
      4000,
      1,
    );
    await page.click('button[aria-label="Select Union"]');
    await click("Remove boolean");
    expect(await page.$$eval(".studio-tree li", (els) => els.length)).toBe(2);
  }, 120000);
});
