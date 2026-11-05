const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const click = (label) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    if (!b) throw Error(text);
    b.click();
  }, label);
const value = (label) =>
  page.$eval(`input[aria-label="${label}"]`, (el) => el.value);
async function numeric(label, n) {
  const el = await page.$(`input[aria-label="${label}"]`);
  await el.focus();
  await el.evaluate((e) => e.select());
  await page.keyboard.type(String(n));
  await page.keyboard.press("Enter");
}
async function captureDownload(button) {
  await page.evaluate(() => {
    window.lastDownload = undefined;
    HTMLAnchorElement.prototype.click = function () {
      const href = this.href;
      window.downloadName = this.download;
      window.lastDownloadPromise = fetch(href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.lastDownload = Array.from(new Uint8Array(b))));
    };
  });
  await click(button);
  await page.waitForFunction(() => window.lastDownload?.length > 0, {
    timeout: 60000,
  });
  return Buffer.from(await page.evaluate(() => window.lastDownload));
}
function stlBounds(buffer) {
  const count = buffer.readUInt32LE(80);
  expect(buffer.length).toBe(84 + 50 * count);
  expect(count).toBeGreaterThan(0);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++)
    for (let v = 0; v < 3; v++)
      for (let a = 0; a < 3; a++) {
        const n = buffer.readFloatLE(84 + 50 * t + 12 + 12 * v + 4 * a);
        expect(Number.isFinite(n)).toBe(true);
        min[a] = Math.min(min[a], n);
        max[a] = Math.max(max[a], n);
      }
  return { min, max, size: max.map((n, i) => n - min[i]) };
}

async function nativeProject() {
  const bytes = await captureDownload("Save project");
  require("fs").writeFileSync("/tmp/forma-native-example.forma3d", bytes);
  const zip = await require("jszip").loadAsync(bytes, { checkCRC32: true });
  return JSON.parse(await zip.file("project.json").async("string"));
}
describe("Forma3D visual foundation", () => {
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
  beforeEach(async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${base}?studio=1`);
    await page.waitForFunction(
      () => document.querySelector("button")?.disabled === false,
    );
    page.once("dialog", (d) => d.accept());
    await click("New");
    await page.waitForSelector('canvas[aria-label="Interactive 3D workspace"]');
  });
  test("create, edit, transform, history, recovery and exact STL dimensions", async () => {
    await click("＋ box");
    await page.waitForSelector('input[aria-label="Width (mm)"]');
    await numeric("Width (mm)", 50);
    await numeric("Depth (mm)", 30);
    await numeric("Height (mm)", 20);
    await numeric("position X", 15);
    await numeric("rotation Z", 90);
    expect(await value("position X")).toBe("15");
    await click("Undo");
    expect(await value("rotation Z")).toBe("0");
    await click("Redo");
    expect(await value("rotation Z")).toBe("90");
    const project = await nativeProject();
    expect(project.bodies[0].size).toEqual([50, 30, 20]);
    expect(project.bodies[0].position).toEqual([15, 0, 10]);
    const mesh = await captureDownload("Export exact STL");
    require("fs").writeFileSync("/tmp/forma-example.stl", mesh);
    require("fs").writeFileSync(
      "/tmp/forma-example.json",
      JSON.stringify(project, null, 2),
    );
    const bounds = stlBounds(mesh);
    expect(bounds.size).toEqual([30, 50, 20]);
    expect(bounds.min).toEqual([0, -25, 0]);
    // Wait for completed IndexedDB persistence and reload through the actual route.
    await page.waitForFunction(
      () =>
        document
          .querySelector("footer")
          .textContent.includes("Saved locally") ||
        document
          .querySelector("footer")
          .textContent.includes("Exact STL exported"),
    );
    await new Promise((r) => setTimeout(r, 650));
    await page.reload();
    await page.waitForSelector('button[aria-label="Select Box"]');
    await page.click('button[aria-label="Select Box"]');
    expect(await value("Width (mm)")).toBe("50");
    expect(await value("rotation Z")).toBe("90");
    expect((await nativeProject()).bodies[0].id).toBe(project.bodies[0].id);
    await page.screenshot({ path: "/workspace/forma3d-studio.png" });
  }, 120000);
  test("raycast selection, pointer gizmo movement, one-step undo and Escape cancellation", async () => {
    await click("＋ box");
    await page.waitForSelector('input[aria-label="position X"]');
    await click("Fit all");
    const canvas = await page.$("canvas");
    const rect = await canvas.boundingBox();
    await page.mouse.click(rect.x + 12, rect.y + 12);
    expect(await page.$('input[aria-label="position X"]')).toBeNull();
    // The fit camera and gizmo scale follow Three.js' documented perspective math.
    const center = [0, 0, 10],
      distance = Math.sqrt(1200) * 1.8;
    const normalize = (v) => {
      const l = Math.hypot(...v);
      return v.map((n) => n / l);
    };
    const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const direction = normalize([1, -1, 0.8]),
      forward = direction.map((n) => -n),
      right = normalize(cross(forward, [0, 0, 1])),
      up = cross(right, forward);
    const position = center.map((n, i) => n + distance * direction[i]);
    const screen = (v) => {
      const d = v.map((n, i) => n - position[i]);
      const depth = dot(d, forward),
        f = Math.tan((42 * Math.PI) / 360);
      return {
        x:
          rect.x +
          ((dot(d, right) / ((depth * f * rect.width) / rect.height) + 1) *
            rect.width) /
            2,
        y: rect.y + ((1 - dot(d, up) / (depth * f)) * rect.height) / 2,
      };
    };
    const c = screen(center);
    await page.mouse.click(c.x, c.y);
    await page.waitForSelector('input[aria-label="position X"]');
    const factor = (distance * 1.9 * Math.tan((42 * Math.PI) / 360) * 0.85) / 4;
    const start = screen([factor * 0.53, 0, 10]);
    const end = screen([factor * 0.53 + 10, 0, 10]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    expect(Number(await value("position X"))).toBeGreaterThan(0);
    expect(Number(await value("position Y"))).toBe(0);
    await click("Undo");
    expect(Number(await value("position X"))).toBe(0);
    // Cancel another drag and then release: it must not create a history command.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(Number(await value("position X"))).toBe(0);
    await click("Undo");
    expect(await page.$$eval(".studio-tree li", (els) => els.length)).toBe(0);
  });
  test("responsive canvas resizing keeps real pointer controls usable without runtime overlays", async () => {
    const errors = [];
    const onError = (error) => errors.push(error.message);
    page.on("pageerror", onError);
    try {
      await page.setViewport({ width: 800, height: 600 });
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      const box = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "＋ box",
        ),
      );
      await box.asElement().click();
      await box.dispose();
      await page.waitForSelector('input[aria-label="Width (mm)"]');
      for (const size of [
        { width: 360, height: 740 },
        { width: 1440, height: 900 },
        { width: 800, height: 600 },
      ]) {
        await page.setViewport(size);
        await click("Orthographic");
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        expect(await page.$("#webpack-dev-server-client-overlay")).toBeNull();
      }
      expect(stlBounds(await captureDownload("Export exact STL")).size).toEqual(
        [20, 20, 20],
      );
      expect(errors).toEqual([]);
    } finally {
      page.off("pageerror", onError);
    }
  }, 90000);
  test("project import validates input without destroying the current document", async () => {
    const fs = require("fs");
    await click("＋ sphere");
    await page.waitForSelector('input[aria-label="Width (mm)"]');
    const original = await nativeProject();
    fs.writeFileSync(
      "/tmp/forma-invalid-project.json",
      JSON.stringify({ ...original, version: 999 }),
    );
    const input = await page.$("input[type=file]");
    await input.uploadFile("/tmp/forma-invalid-project.json");
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Open failed"),
    );
    expect((await nativeProject()).bodies[0].id).toBe(original.bodies[0].id);
    await click("＋ box");
    expect(await page.$$eval(".studio-tree li", (els) => els.length)).toBe(2);
    fs.writeFileSync("/tmp/forma-valid-project.json", JSON.stringify(original));
    await input.uploadFile("/tmp/forma-valid-project.json");
    await page.waitForFunction(
      () => document.querySelectorAll(".studio-tree li").length === 1,
    );
    expect((await nativeProject()).bodies[0].kind).toBe("sphere");
    await click("＋ box");
    await input.uploadFile("/tmp/forma-native-example.forma3d");
    await page.waitForFunction(
      () => document.querySelectorAll(".studio-tree li").length === 1,
    );
    await page.click('button[aria-label="Select Sphere"]');
    const name = await page.$('input[aria-label="Object name"]');
    await name.focus();
    await name.evaluate((el) => el.select());
    await page.keyboard.type("Ball");
    await page.keyboard.press("Tab");
    await click("Undo");
    expect(await value("Object name")).toBe("Sphere");
    await numeric("position X", 0.000004);
    const precise = await page.$('input[aria-label="position X"]');
    await precise.focus();
    await page.keyboard.press("Tab");
    expect((await nativeProject()).bodies[0].position[0]).toBe(0.000004);
    await numeric("position X", 0);
    const width = await page.$('input[aria-label="Width (mm)"]');
    await width.focus();
    await width.evaluate((el) => el.select());
    await page.keyboard.type("100");
    await page.keyboard.press("Escape");
    expect(await value("Width (mm)")).toBe("20");
    await click("Orthographic");
    expect(await page.$eval("canvas", (el) => el.width > 0)).toBe(true);
    expect(
      await page.$eval(
        "input[type=file]",
        (el) => getComputedStyle(el).display,
      ),
    ).toBe("none");
  });
  test("canceling an exact export keeps the editable body and permits retry", async () => {
    await click("＋ box");
    await page.waitForSelector('input[aria-label="Width (mm)"]');
    await page.evaluate(() => {
      window.lastDownload = undefined;
      HTMLAnchorElement.prototype.click = function () {
        window.lastDownload = this.download;
      };
    });
    await click("Export exact STL");
    await click("Cancel export");
    await page.waitForFunction(() =>
      document
        .querySelector("footer")
        .textContent.includes("Export failed: Error: Export canceled."),
    );
    expect(await page.evaluate(() => window.lastDownload)).toBeUndefined();
    expect(await value("Width (mm)")).toBe("20");
    expect(stlBounds(await captureDownload("Export exact STL")).size).toEqual([
      20, 20, 20,
    ]);
    // Commit another edit so afterEach can wait for its completed local save.
    await numeric("position X", 1);
  }, 90000);
  test("visibility, locking, duplication and deletion respect history", async () => {
    await click("＋ cylinder");
    await page.waitForSelector('input[aria-label="Width (mm)"]');
    await click("Duplicate");
    expect(await page.$$eval(".studio-tree li", (els) => els.length)).toBe(2);
    await click("Delete");
    expect(await page.$$eval(".studio-tree li", (els) => els.length)).toBe(1);
    await page.click('button[aria-label="Select Cylinder"]');
    await page.click('button[aria-label="Toggle lock Cylinder"]');
    expect(
      await page.$eval(
        'input[aria-label="Width (mm)"]',
        (el) => el.disabled || el.closest("fieldset").disabled,
      ),
    ).toBe(true);
    await page.click('button[aria-label="Toggle visibility Cylinder"]');
    expect(
      await page.$eval(
        'button[aria-label="Toggle visibility Cylinder"]',
        (el) => el.getAttribute("aria-pressed"),
      ),
    ).toBe("false");
    await click("Undo");
    expect(
      await page.$eval(
        'button[aria-label="Toggle visibility Cylinder"]',
        (el) => el.getAttribute("aria-pressed"),
      ),
    ).toBe("true");
  });
});
