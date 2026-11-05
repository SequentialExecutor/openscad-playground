const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const click = (label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === label,
    );
    if (!b) throw Error(label);
    b.click();
  }, label);
async function numeric(label, n) {
  const modal = await page.$(".studio-sketch-editor");
  const input = await (modal ?? page).$(`input[aria-label="${label}"]`);
  await input.focus();
  await input.evaluate((el) => el.select());
  await page.keyboard.type(String(n));
  await page.keyboard.press("Enter");
}
async function download(label) {
  await page.evaluate(() => {
    window.sketchDownload = undefined;
    HTMLAnchorElement.prototype.click = function () {
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.sketchDownload = Array.from(new Uint8Array(b))));
    };
  });
  await click(label);
  await page.waitForFunction(() => window.sketchDownload?.length > 0, {
    timeout: 60000,
  });
  return Buffer.from(await page.evaluate(() => window.sketchDownload));
}
function geometry(buffer) {
  const n = buffer.readUInt32LE(80);
  expect(buffer.length).toBe(84 + 50 * n);
  let volume = 0;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    const p = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((a) =>
        buffer.readFloatLE(84 + t * 50 + 12 + 12 * v + 4 * a),
      ),
    );
    p.forEach((v) =>
      v.forEach((n, a) => {
        min[a] = Math.min(n, min[a]);
        max[a] = Math.max(n, max[a]);
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
async function ready() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".studio-legend")].some((el) =>
        el.textContent.includes("Exact geometry up to date"),
      ),
    { timeout: 60000 },
  );
}
async function apply() {
  await click("Apply extrusion");
  await page.waitForFunction(
    () => !document.querySelector(".studio-sketch-editor"),
  );
  await ready();
}
async function draw(points) {
  const svg = await page.$('svg[aria-label="2D sketch canvas"]');
  for (const [x, y] of points) {
    const p = await svg.evaluate(
      (el, p) => {
        const v = el.createSVGPoint();
        v.x = p[0];
        v.y = -p[1];
        const c = v.matrixTransform(el.getScreenCTM());
        return { x: c.x, y: c.y };
      },
      [x, y],
    );
    await page.mouse.click(p.x, p.y);
  }
}
describe("Parametric sketch extrusion", () => {
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
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
  }, 15000);
  test("dimensioned sketch extrudes, propagates through a hole, undoes, and reloads", async () => {
    await click("Sketch & extrude");
    await page.waitForSelector('[role=dialog][aria-label="Sketch editor"]');
    await numeric("Sketch width (mm)", 40);
    await numeric("Sketch depth (mm)", 30);
    await numeric("Extrusion height (mm)", 12);
    expect(
      await page.$eval(".studio-sketch-status", (el) => el.textContent),
    ).toContain("Fully constrained");
    const width = await page.$(
      '.studio-sketch-editor input[aria-label="Sketch width (mm)"]',
    );
    await width.focus();
    await width.evaluate((el) => el.select());
    await page.keyboard.type("99");
    await page.keyboard.press("Escape");
    expect(await page.$(".studio-sketch-editor")).not.toBeNull();
    expect(
      await page.$eval(".studio-sketch-editor", (el) =>
        el.contains(document.activeElement),
      ),
    ).toBe(true);
    expect(
      await page.$eval('nav[aria-label="Project tools"]', (el) => el.inert),
    ).toBe(true);
    expect(await width.evaluate((el) => el.value)).toBe("40");
    await click("Fit profile");
    await page.screenshot({ path: "/tmp/forma-sketch-editor.png" });
    await apply();
    const first = geometry(await download("Export exact STL"));
    expect(first.size).toEqual([40, 30, 12]);
    expect(first.volume).toBeCloseTo(14400, 1);
    await click("＋ cylinder");
    await numeric("Diameter (mm)", 6);
    await numeric("Height (mm)", 20);
    await numeric("position X", 10);
    await numeric("position Y", 10);
    await numeric("position Z", 6);
    await click("Difference");
    await ready();
    const holeArea = (64 * 9 * Math.sin((2 * Math.PI) / 64)) / 2;
    expect(geometry(await download("Export exact STL")).volume).toBeCloseTo(
      14400 - holeArea * 12,
      1,
    );
    await page.click('button[aria-label="Select Sketch extrusion"]');
    await click("Edit sketch");
    await numeric("Sketch width (mm)", 60);
    await apply();
    expect(geometry(await download("Export exact STL")).volume).toBeCloseTo(
      21600 - holeArea * 12,
      1,
    );
    await click("Undo");
    await ready();
    expect(geometry(await download("Export exact STL")).volume).toBeCloseTo(
      14400 - holeArea * 12,
      1,
    );
    await click("Redo");
    await ready();
    const zip = await download("Save project");
    require("fs").writeFileSync("/tmp/forma-sketch-example.forma3d", zip);
    require("fs").writeFileSync(
      "/tmp/forma-sketch-example.stl",
      await download("Export exact STL"),
    );
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Saved locally"),
    );
    await page.reload();
    await ready();
    expect(geometry(await download("Export exact STL")).volume).toBeCloseTo(
      21600 - holeArea * 12,
      1,
    );
  }, 120000);
  test("circle profile on YZ produces the specified real bounds", async () => {
    await click("Sketch & extrude");
    await page.select('select[aria-label="Sketch shape"]', "circle");
    await page.select('select[aria-label="Sketch plane"]', "YZ");
    await numeric("Sketch radius (mm)", 5);
    await numeric("Sketch anchor Y (mm)", 5);
    await numeric("Extrusion height (mm)", 8);
    await apply();
    const mesh = geometry(await download("Export exact STL"));
    mesh.size.forEach((n, i) => expect(n).toBeCloseTo([8, 10, 10][i], 4));
    mesh.min.forEach((n, i) => expect(n).toBeCloseTo([0, -5, 0][i], 4));
    mesh.max.forEach((n, i) => expect(n).toBeCloseTo([8, 5, 10][i], 4));
    expect(mesh.volume).toBeCloseTo(
      ((64 * 25 * Math.sin((2 * Math.PI) / 64)) / 2) * 8,
      1,
    );
  }, 90000);
  test("pointer-drawn polygons report constraint freedom and reject self-intersections", async () => {
    await click("Sketch & extrude");
    await page.select('select[aria-label="Sketch shape"]', "polygon");
    await click("Draw new polygon");
    await draw([
      [0, 0],
      [20, 20],
      [0, 20],
      [20, 0],
    ]);
    await click("Close profile");
    expect(
      await page.$eval(".studio-sketch-status", (el) => el.textContent),
    ).toContain("self-intersects");
    expect(
      await page.$eval(
        "button:not([disabled])",
        () =>
          [...document.querySelectorAll("button")].find(
            (b) => b.textContent === "Apply extrusion",
          ).disabled,
      ),
    ).toBe(true);
    await click("Draw new polygon");
    await draw([
      [0, 0],
      [20, 0],
      [15, 15],
      [0, 15],
    ]);
    await click("Close profile");
    await click("Add constraint");
    expect(
      await page.$eval(".studio-sketch-status", (el) => el.textContent),
    ).toContain("Underconstrained: 7");
    await numeric("Extrusion height (mm)", 8);
    await apply();
    expect(geometry(await download("Export exact STL")).volume).toBeCloseTo(
      2100,
      1,
    );
  }, 90000);
  test("numeric vertex entry works without canvas drawing", async () => {
    await click("Sketch & extrude");
    await page.select('select[aria-label="Sketch shape"]', "polygon");
    await click("Draw new polygon");
    for (const [x, y] of [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ]) {
      await numeric("Point X (mm)", x);
      await numeric("Point Y (mm)", y);
      await click("Add point");
    }
    await click("Close profile");
    await numeric("Extrusion height (mm)", 5);
    await apply();
    expect(geometry(await download("Export exact STL")).volume).toBeCloseTo(
      1000,
      1,
    );
  }, 90000);
});
