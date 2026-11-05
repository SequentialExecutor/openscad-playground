const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const click = (label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === label,
    );
    if (!b) throw Error(label);
    b.click();
  }, label);
const open = (label) =>
  page.evaluate((label) => {
    const s = [...document.querySelectorAll("summary")].find(
      (s) => s.textContent.trim() === label,
    );
    if (!s) throw Error(label);
    if (!s.parentElement.open) s.click();
  }, label);
async function numeric(label, n) {
  const el = await page.waitForSelector(`input[aria-label="${label}"]`);
  if (!el) throw Error(label);
  await el.focus();
  await el.evaluate((el) => el.select());
  await page.keyboard.type(String(n));
  await page.keyboard.press("Enter");
}
async function name(text) {
  const el = await page.$('input[aria-label="Object name"]');
  await el.focus();
  await el.evaluate((el) => el.select());
  await page.keyboard.type(text);
  await page.keyboard.press("Tab");
}
async function ready() {
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
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
    window.advancedDownload = undefined;
    HTMLAnchorElement.prototype.click = function () {
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.advancedDownload = Array.from(new Uint8Array(b))));
    };
  });
  await click(label);
  await page.waitForFunction(() => window.advancedDownload?.length > 0, {
    timeout: 60000,
  });
  return Buffer.from(await page.evaluate(() => window.advancedDownload));
}
async function project() {
  const zip = await require("jszip").loadAsync(await download("Save project"));
  return JSON.parse(await zip.file("project.json").async("string"));
}
function mesh(buffer) {
  const n = buffer.readUInt32LE(80);
  expect(n).toBeGreaterThan(0);
  expect(buffer.length).toBe(84 + 50 * n);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity],
    triangles = [];
  let volume = 0;
  for (let t = 0; t < n; t++) {
    const p = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((a) =>
        buffer.readFloatLE(84 + 50 * t + 12 + 12 * v + 4 * a),
      ),
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
    triangles.push(p);
  }
  const edges = new Map();
  for (const p of triangles)
    for (let i = 0; i < 3; i++) {
      const a = JSON.stringify(p[i]),
        b = JSON.stringify(p[(i + 1) % 3]);
      const key = a < b ? a + "|" + b : b + "|" + a;
      const edge = edges.get(key) ?? [0, 0];
      edge[0]++;
      edge[1] += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  expect(
    [...edges.values()].every(
      ([count, balance]) => count === 2 && balance === 0,
    ),
  ).toBe(true);
  return {
    min,
    max,
    size: max.map((n, i) => n - min[i]),
    volume: Math.abs(volume),
    levels: (x, y) => {
      const zs = [];
      for (const [a, b, c] of triangles) {
        const det =
          (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(det) < 1e-8) continue;
        const u =
            ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det,
          v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
        if (u > 1e-7 && v > 1e-7 && u + v < 1 - 1e-7)
          zs.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
      }
      return zs.sort((a, b) => a - b);
    },
  };
}
const factor = (64 * Math.sin((2 * Math.PI) / 64)) / 2;
async function advanced(label) {
  await open("Advanced modeling");
  await click(label);
  await ready();
}
async function removeFeature() {
  await click("Remove modeling feature");
}
async function template(kind) {
  await open("Mechanical templates");
  await page.select('select[aria-label="Mechanical template"]', kind);
  await click("Add mechanical template");
  await ready();
}
async function positioned(label) {
  await click(label);
  await page.waitForFunction(
    () =>
      document
        .querySelector("footer")
        .textContent.includes("Exact positioning complete"),
    { timeout: 60000 },
  );
}

describe("Advanced parametric modeling", () => {
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
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Saved locally"),
    );
  }, 15000);
  test("bounded box fillet/chamfer and shell change real geometry and preserve outer dimensions", async () => {
    await click("＋ box");
    await numeric("Width (mm)", 40);
    await numeric("Depth (mm)", 30);
    await advanced("Box vertical fillet");
    let r = mesh(await download("Export exact STL"));
    expect(r.size).toEqual([40, 30, 20]);
    expect(r.volume).toBeCloseTo(24000 - (4 - factor) * 4 * 20, 1);
    await numeric("Vertical edge radius (mm)", 4);
    await ready();
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      24000 - (4 - factor) * 16 * 20,
      1,
    );
    await numeric("Vertical edge radius (mm)", 100);
    await page.waitForFunction(() =>
      document
        .querySelector("footer")
        .textContent.includes("smaller than half"),
    );
    expect(
      await page.$eval('input[aria-label="Vertical edge radius (mm)"]', (el) =>
        Number(el.value),
      ),
    ).toBe(4);
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      24000 - (4 - factor) * 16 * 20,
      1,
    );
    await advanced("Shell");
    await numeric("Shell wall (mm)", 3);
    await ready();
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      // Insetting the actual 64-segment rounded outline preserves a uniform
      // polygon-wall distance; its inset is not a separately tessellated circle.
      (1200 - (4 - factor) * 16) * 3 +
        17 *
          (3 * (108 + 512 * Math.sin(Math.PI / 64)) -
            9 * (60 * Math.tan(Math.PI / 64) + 8 * Math.tan(Math.PI / 128))),
      1,
    );
    await removeFeature();
    await page.click('button[aria-label="Select Box vertical fillet"]');
    await removeFeature();
    await page.click('button[aria-label="Select Box"]');
    await advanced("Box vertical chamfer");
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      23840,
      1,
    );
    await removeFeature();
    await page.click('button[aria-label="Select Box"]');
    await advanced("Shell");
    await numeric("Shell wall (mm)", 3);
    await ready();
    r = mesh(await download("Export exact STL"));
    expect(r.volume).toBeCloseTo(10128, 1);
    expect(r.levels(0.137, 0.219).at(-1)).toBeCloseTo(3, 4);
    await page.click('input[aria-label="Open shell top"]');
    await ready();
    r = mesh(await download("Export exact STL"));
    expect(r.volume).toBeCloseTo(12576, 1);
    expect(r.levels(0.137, 0.219)).toHaveLength(4);
  }, 120000);
  test("mirror and editable patterns preserve sources and transform the result", async () => {
    await click("＋ box");
    for (const l of ["Width (mm)", "Depth (mm)", "Height (mm)"])
      await numeric(l, 10);
    await numeric("position Z", 5);
    await numeric("position X", 20);
    await advanced("Mirror");
    let r = mesh(await download("Export exact STL"));
    expect(r.min[0]).toBe(-25);
    expect(r.max[0]).toBe(25);
    expect(r.volume).toBeCloseTo(2000, 1);
    await removeFeature();
    await page.click('button[aria-label="Select Box"]');
    await advanced("Linear pattern");
    await numeric("Pattern count", 4);
    await numeric("Pattern step X (mm)", 20);
    await ready();
    r = mesh(await download("Export exact STL"));
    expect(r.max[0]).toBe(85);
    expect(r.volume).toBeCloseTo(4000, 1);
    await removeFeature();
    await page.click('button[aria-label="Select Box"]');
    await advanced("Circular pattern");
    await numeric("Pattern count", 3);
    await ready();
    const original = mesh(await download("Export exact STL"));
    expect(original.volume).toBeCloseTo(3000, 1);
    await numeric("Result position X", 5);
    await ready();
    r = mesh(await download("Export exact STL"));
    expect(r.min[0]).toBeCloseTo(original.min[0] + 5, 4);
    expect(r.max[0]).toBeCloseTo(original.max[0] + 5, 4);
    expect((await project()).bodies[0].position[0]).toBe(20);
  }, 120000);
  test("profile offset and rotational extrusion produce valid measured solids", async () => {
    await click("Sketch & extrude");
    await page.waitForSelector(".studio-sketch-editor");
    const modalNumber = async (label, n) => {
      const el = await page.$(
        `.studio-sketch-editor input[aria-label="${label}"]`,
      );
      await el.focus();
      await el.evaluate((el) => el.select());
      await page.keyboard.type(String(n));
      await page.keyboard.press("Enter");
    };
    await modalNumber("Sketch depth (mm)", 10);
    await modalNumber("Extrusion height (mm)", 5);
    await click("Apply extrusion");
    await page.waitForFunction(
      () => !document.querySelector(".studio-sketch-editor"),
    );
    await ready();
    await advanced("Profile offset");
    await page.select('select[aria-label="Offset join"]', "miter");
    await ready();
    let r = mesh(await download("Export exact STL"));
    expect(r.size).toEqual([24, 14, 5]);
    expect(r.volume).toBeCloseTo(1680, 1);
    await numeric("Profile offset (mm)", -1);
    await ready();
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(720, 1);
    await removeFeature();
    await page.click('button[aria-label="Select Sketch extrusion"]');
    await click("Edit sketch");
    await modalNumber("Sketch width (mm)", 5);
    await modalNumber("Sketch depth (mm)", 20);
    await modalNumber("Sketch anchor X (mm)", 10);
    await click("Apply extrusion");
    await page.waitForFunction(
      () => !document.querySelector(".studio-sketch-editor"),
    );
    await ready();
    await advanced("Revolution");
    r = mesh(await download("Export exact STL"));
    expect(r.volume).toBeCloseTo(factor * (225 - 100) * 20, 1);
    expect(r.size).toEqual([30, 30, 20]);
    await numeric("Revolution angle (degrees)", 180);
    await ready();
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      factor * (225 - 100) * 10,
      1,
    );
  }, 120000);
  test("enclosure wall, four posts and holes follow width changes and survive native reload", async () => {
    await template("enclosure");
    await page.click('input[aria-label="Enclosure mounting posts"]');
    await page.click('input[aria-label="Enclosure post holes"]');
    await numeric("Enclosure width (mm)", 120);
    await ready();
    const bytes = await download("Export exact STL"),
      r = mesh(bytes);
    expect(r.size).toEqual([120, 60, 30]);
    expect(r.levels(0.137, 0.219).at(-1)).toBeCloseTo(3, 4);
    expect(r.levels(50.137, 20.219)).toHaveLength(0);
    expect(r.levels(53, 20.137).at(-1)).toBeCloseTo(9, 4);
    expect(r.levels(40.137, 20.219).at(-1)).toBeCloseTo(3, 4);
    require("fs").writeFileSync("/tmp/forma-enclosure.stl", bytes);
    require("fs").writeFileSync(
      "/tmp/forma-enclosure.forma3d",
      await download("Save project"),
    );
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Saved locally"),
    );
    await page.reload();
    await ready();
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      r.volume,
      1,
    );
  }, 120000);
  test("rounded enclosure rejects protruding posts and accepts an inset that keeps all four inside", async () => {
    await template("enclosure");
    await numeric("Enclosure corner radius (mm)", 29);
    await numeric("Mounting inset (mm)", 7);
    await page.click('input[aria-label="Enclosure mounting posts"]');
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("rounded corners"),
    );
    expect(
      await page.$eval(
        'input[aria-label="Enclosure mounting posts"]',
        (el) => el.checked,
      ),
    ).toBe(false);
    await numeric("Mounting inset (mm)", 14);
    await page.click('input[aria-label="Enclosure mounting posts"]');
    await page.click('input[aria-label="Enclosure post holes"]');
    await ready();
    const p = await project();
    expect(p.bodies[0].template.posts).toBe(true);
    expect(p.bodies[0].template.inset).toBe(14);
    const r = mesh(await download("Export exact STL"));
    expect(r.size).toEqual([100, 60, 30]);
    expect(r.levels(36.137, 16.219)).toHaveLength(0);
    expect(r.levels(39, 16.137).at(-1)).toBeCloseTo(9, 4);
  }, 90000);
  test("thin-part countersink ignores unused counterbore depth and cuts the measured cone", async () => {
    await click("＋ box");
    await numeric("Width (mm)", 20);
    await numeric("Depth (mm)", 20);
    await numeric("Height (mm)", 1);
    await numeric("position Z", 0.5);
    await template("hole");
    await numeric("Head recess diameter (mm)", 4);
    await page.select('select[aria-label="Hole cutter style"]', "countersink");
    await numeric("Hole cutter depth (mm)", 1);
    expect(
      (await project()).bodies.find((b) => b.kind === "template").template
        .headDepth,
    ).toBe(3);
    await click("Difference");
    await ready();
    const r = mesh(await download("Export exact STL")),
      h = 0.4;
    expect(r.size).toEqual([20, 20, 1]);
    expect(r.volume).toBeCloseTo(
      400 - factor * (1.6 ** 2 * (1 - h) + (h * (1.6 ** 2 + 1.6 * 2 + 4)) / 3),
      2,
    );
    expect(r.levels(1.8, 0.137).at(-1)).toBeGreaterThan(0.6);
    expect(r.levels(1.8, 0.137).at(-1)).toBeLessThan(1);
  }, 90000);
  test("counterbore and countersink cutters actually cut the specified recess", async () => {
    await click("＋ box");
    await numeric("Width (mm)", 40);
    await numeric("Depth (mm)", 30);
    await numeric("Height (mm)", 10);
    await numeric("position Z", 5);
    await template("hole");
    await numeric("Hole cutter depth (mm)", 10);
    await page.select('select[aria-label="Hole cutter style"]', "counterbore");
    await click("Difference");
    await ready();
    let r = mesh(await download("Export exact STL"));
    expect(r.volume).toBeCloseTo(
      12000 - factor * (1.6 ** 2 * 7 + 3.25 ** 2 * 3),
      1,
    );
    expect(r.levels(2.1, 0.137).at(-1)).toBeCloseTo(7, 4);
    await page.click('button[aria-label="Select Hole cutter"]');
    await page.waitForSelector('select[aria-label="Hole cutter style"]');
    await page.select('select[aria-label="Hole cutter style"]', "countersink");
    await ready();
    r = mesh(await download("Export exact STL"));
    const h = 1.65;
    expect(r.volume).toBeCloseTo(
      12000 -
        factor *
          (1.6 ** 2 * (10 - h) + (h * (1.6 ** 2 + 1.6 * 3.25 + 3.25 ** 2)) / 3),
      1,
    );
  }, 120000);
  test.each([
    ["spacer", factor * (25 - 6.25) * 5],
    ["standoff", factor * ((16 - 2.25) * 10 + 20 * 2)],
    ["mounting-tab", 896],
    ["alignment-pin", factor * (6.25 * 8 + ((6.25 + 5 + 4) * 2) / 3)],
    ["snap-reference", 332],
  ])(
    "%s template exports actual closed geometry",
    async (kind, volume) => {
      await template(kind);
      expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
        volume,
        1,
      );
    },
    90000,
  );
  test("modeling result gizmo preserves its source and commits one undo step", async () => {
    await click("＋ box");
    await advanced("Box vertical fillet");
    await click("Fit all");
    const rect = await (await page.$("canvas")).boundingBox(),
      center = [0, 0, 10],
      distance = Math.sqrt(1200) * 1.8;
    const normalize = (v) => {
        const l = Math.hypot(...v);
        return v.map((n) => n / l);
      },
      dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0),
      cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    const direction = normalize([1, -1, 0.8]),
      forward = direction.map((n) => -n),
      right = normalize(cross(forward, [0, 0, 1])),
      up = cross(right, forward),
      position = center.map((n, i) => n + distance * direction[i]),
      f = Math.tan((42 * Math.PI) / 360);
    const screen = (v) => {
      const d = v.map((n, i) => n - position[i]),
        depth = dot(d, forward);
      return {
        x:
          rect.x +
          ((dot(d, right) / ((depth * f * rect.width) / rect.height) + 1) *
            rect.width) /
            2,
        y: rect.y + ((1 - dot(d, up) / (depth * f)) * rect.height) / 2,
      };
    };
    const factor = (Math.hypot(...position) * 1.9 * f * 0.85) / 4,
      start = screen([factor * 0.53, 0, 0]),
      end = screen([factor * 0.53 + 10, 0, 0]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    let p = await project();
    expect(p.features[0].position[0]).toBeGreaterThan(0);
    expect(p.bodies[0].position).toEqual([0, 0, 10]);
    const r = mesh(await download("Export exact STL"));
    expect(r.min[0]).toBeCloseTo(p.features[0].position[0] - 10, 4);
    await click("Undo");
    p = await project();
    expect(p.features[0].position).toEqual([0, 0, 0]);
    await click("Undo");
    expect((await project()).features).toHaveLength(0);
  }, 90000);
  test("exact bounds align, distribute and place objects; groups move without changing sources", async () => {
    await click("＋ box");
    for (const l of ["Width (mm)", "Depth (mm)", "Height (mm)"])
      await numeric(l, 10);
    await numeric("position X", -30);
    await numeric("position Z", 15);
    await name("A");
    await click("Duplicate");
    await name("B");
    await numeric("position X", -12);
    await click("Duplicate");
    await name("C");
    await numeric("position X", 30);
    await open("Align & distribute");
    for (const n of ["A", "B", "C"])
      await page.click(`input[aria-label="Distribute ${n}"]`);
    await positioned("Distribute bounds");
    let p = await project();
    expect(p.bodies.find((b) => b.name === "B").position[0]).toBe(0);
    await page.click('button[aria-label="Select B"]');
    await numeric("position Z", 25);
    p = await project();
    await page.select(
      'select[aria-label="Positioning reference"]',
      p.bodies.find((b) => b.name === "A").id,
    );
    await page.select('select[aria-label="Positioning axis"]', "2");
    await page.select('select[aria-label="Alignment anchor"]', "min");
    await positioned("Align bounds");
    expect(
      (await project()).bodies.find((b) => b.name === "B").position[2],
    ).toBe(15);
    await positioned("Place on build plate");
    expect(
      (await project()).bodies.find((b) => b.name === "B").position[2],
    ).toBe(5);
    await open("Advanced modeling");
    await page.click('input[aria-label="Group A"]');
    await page.click('input[aria-label="Group B"]');
    await click("Group selected roots");
    await ready();
    await numeric("Result position X", 10);
    await ready();
    p = await project();
    expect(p.bodies.find((b) => b.name === "A").position[0]).toBe(-30);
    expect(p.bodies.find((b) => b.name === "B").position[0]).toBe(0);
    expect(mesh(await download("Export exact STL")).volume).toBeCloseTo(
      3000,
      1,
    );
  }, 120000);
});
