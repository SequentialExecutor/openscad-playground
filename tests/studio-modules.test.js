const fs = require("fs"),
  path = require("path"),
  os = require("os");
const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const flower = fs.readFileSync(
  path.resolve("examples/forma3d/flower-modules.scad"),
  "utf8",
);
let context, page, temp;
const click = (label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === label,
    );
    if (!b) throw Error(label);
    b.click();
  }, label);
const ready = () =>
  page.waitForFunction(
    () => document.querySelector("button")?.disabled === false,
  );
const saved = () =>
  page.waitForFunction(() =>
    document.querySelector("footer")?.textContent.includes("Saved locally"),
  );
async function source() {
  await page.bringToFront();
  await page.waitForSelector(".monaco-editor .view-lines", { timeout: 45000 });
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
}
async function edit(text) {
  await source();
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await context.overridePermissions(new URL(base).origin, [
    "clipboard-read",
    "clipboard-write",
    "clipboard-sanitized-write",
  ]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), text);
  await page.keyboard.down("Control");
  await page.keyboard.press("V");
  await page.keyboard.up("Control");
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const actual = await source();
  await page.waitForFunction(
    (actual) =>
      new Promise((resolve) => {
        const id = new URLSearchParams(location.search).get("workspace");
        if (!id) {
          resolve(true);
          return;
        }
        const q = indexedDB.open("forma3d-studio", 1);
        q.onsuccess = () => {
          const db = q.result,
            r = db
              .transaction("projects")
              .objectStore("projects")
              .get("workspace:" + id);
          r.onsuccess = () => {
            const p = r.result.code.params;
            resolve(
              p.sources.find((f) => f.path === p.activePath)?.content ===
                actual,
            );
            db.close();
          };
        };
      }),
    { timeout: 20000 },
    actual,
  );
  return actual;
}
async function toCode() {
  await saved();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.click('a[href="?"]'),
  ]);
  return source();
}
async function beginReturn() {
  await page.click('a[href="?studio=1"]');
  await page.waitForSelector('section[aria-label="Import detected modules"]', {
    timeout: 45000,
  });
}
async function finishReturn(label = "Save selected modules and return") {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load", timeout: 60000 }),
    click(label),
  ]);
  await ready();
}
async function input(label, value) {
  const e = await page.waitForSelector(`input[aria-label="${label}"]`);
  await e.focus();
  await e.evaluate((e) => e.select());
  await page.keyboard.sendCharacter(String(value));
  await page.keyboard.press("Tab");
}
async function library() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const q = indexedDB.open("forma3d-studio", 1);
        q.onsuccess = () => {
          const db = q.result,
            r = db
              .transaction("projects")
              .objectStore("projects")
              .get("module-library");
          r.onsuccess = () => {
            resolve(r.result);
            db.close();
          };
        };
      }),
  );
}
async function download(label) {
  await page.evaluate(() => {
    window.moduleDownload = undefined;
    HTMLAnchorElement.prototype.click = function () {
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.moduleDownload = Array.from(new Uint8Array(b))));
    };
  });
  await click(label);
  await page.waitForFunction(() => window.moduleDownload?.length > 0, {
    timeout: 60000,
  });
  return Buffer.from(await page.evaluate(() => window.moduleDownload));
}
async function native() {
  const zip = await require("jszip").loadAsync(await download("Save project"));
  return JSON.parse(await zip.file("project.json").async("string"));
}
const exact = () =>
  page.waitForFunction(
    () =>
      [...document.querySelectorAll(".studio-legend")].some((e) =>
        e.textContent.includes("Exact geometry up to date"),
      ),
    { timeout: 90000 },
  );
async function importFlower() {
  await click("＋ box");
  const initial = await toCode();
  await edit(initial + "\n" + flower);
  await beginReturn();
  await finishReturn();
}
describe("Reusable authored module library", () => {
  beforeAll(
    () => (temp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-module-test-"))),
  );
  afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
  beforeEach(async () => {
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1600, height: 1100 });
    await page.goto(`${base}?studio=1`);
    await ready();
  }, 20000);
  afterEach(async () => {
    await context?.close();
  }, 20000);
  test("detect the supplied four modules, review dependencies, save library, reuse and edit a parameter", async () => {
    await importFlower();
    const lib = await library();
    expect(lib.entries.map((e) => e.name)).toEqual([
      "petal",
      "ring",
      "bud",
      "stem",
    ]);
    expect(lib.entries.find((e) => e.name === "ring").source).toContain(
      "module petal",
    );
    expect(lib.entries.find((e) => e.name === "ring").source).not.toContain(
      "module stem",
    );
    await page.click(".studio-module-library summary");
    await page.select('select[aria-label="Library module"]', "petal");
    await input("Module parameter len", 18);
    await click("Insert module");
    await exact();
    const p = await native();
    expect(
      p.bodies.some(
        (b) =>
          b.kind === "module" && b.moduleCall.expression.includes("len=18"),
      ),
    ).toBe(true);
    expect(p.meshAssets).toEqual([]);
    expect(
      await page.$eval('header a[role="link"]', (e) =>
        e.getAttribute("aria-disabled"),
      ),
    ).toBe("false");
    const b = p.bodies.find((b) => b.kind === "module");
    await page.click(`button[aria-label="Select ${b.name}"]`);
    await input("Instance parameter len", 20);
    await exact();
    expect(
      (await native()).bodies.find((b) => b.kind === "module").moduleCall
        .expression,
    ).toContain("len=20");
    const code = await toCode();
    expect(code).toContain("module petal");
    expect(code).toContain("petal(len=20)");
    expect(code).not.toMatch(/module n\d+\(/);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.click('a[href="?studio=1"]'),
    ]);
    await ready();
    expect((await native()).bodies.some((b) => b.kind === "module")).toBe(true);
  }, 180000);
  test("definition-only code can cancel or skip library import without losing source or fabricating geometry", async () => {
    await click("＋ box");
    await toCode();
    const actual = await edit(flower);
    await beginReturn();
    await click("Cancel return");
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Import detected modules"]'),
    );
    expect(await source()).toBe(actual);
    expect(await library()).toBeUndefined();
    await beginReturn();
    await finishReturn("Return without saving");
    const p = await native();
    expect(p.bodies).toEqual([]);
    expect(p.authoredSource).toContain("module ring");
    expect(await library()).toBeUndefined();
    expect(await toCode()).toContain("module ring");
  }, 120000);
  test("save a selected native boolean as a module and reuse it in a new project with portable source", async () => {
    await click("＋ box");
    await click("＋ cylinder");
    await click("Difference");
    await exact();
    await page.click(".studio-module-library summary");
    await input("Save module name", "plate_cut");
    await click("Save selected as module");
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Saved 1 module"),
    );
    expect((await library()).entries[0].source).toContain("module plate_cut()");
    const backup = await download("Export module library");
    expect(JSON.parse(backup).entries[0].name).toBe("plate_cut");
    page.once("dialog", (d) => d.accept());
    await click("New");
    await page.select('select[aria-label="Library module"]', "plate_cut");
    await click("Insert module");
    await exact();
    const p = await native();
    expect(p.bodies).toHaveLength(1);
    expect(p.bodies[0].kind).toBe("module");
    expect(p.authoredSource).toContain("difference()");
    const file = path.join(temp, "module.forma3d");
    fs.writeFileSync(file, await download("Save project"));
    page.once("dialog", (d) => d.accept());
    await click("New");
    await (await page.$('input[aria-label="Project file"]')).uploadFile(file);
    await page.waitForSelector('button[aria-label="Select plate_cut"]');
    expect((await native()).authoredSource).toContain("module plate_cut()");
    expect(await toCode()).toContain("plate_cut();");
  }, 180000);
  test("required ring arguments cannot be omitted and update existing library modules requires explicit selection", async () => {
    await importFlower();
    await page.click(".studio-module-library summary");
    await page.select('select[aria-label="Library module"]', "ring");
    expect(
      await page.evaluate(
        () =>
          [...document.querySelectorAll("button")].find(
            (e) => e.textContent === "Insert module",
          ).disabled,
      ),
    ).toBe(true);
    for (const [k, v] of Object.entries({
      n: 4,
      radius: 10,
      len: 12,
      base_r: 2.8,
      tilt: 30,
      z: 0,
      phase: 0,
      col: "[0.55,0.05,0.45]",
    }))
      await input("Module parameter " + k, v);
    await click("Insert module");
    await exact();
    const before = await download("Save project");
    const original = await toCode();
    await edit(original.replace(/len\s*=\s*12/, "len = 15"));
    await beginReturn();
    expect(
      await page.$eval(
        'input[aria-label="Import module petal"]',
        (e) => e.checked,
      ),
    ).toBe(false);
    await page.click('input[aria-label="Import module petal"]');
    await finishReturn();
    expect(
      (await library()).entries.find((e) => e.name === "petal").source,
    ).toMatch(/len\s*=\s*15/);
    const file = path.join(temp, "old-copy.forma3d");
    fs.writeFileSync(file, before);
    await (await page.$('input[aria-label="Project file"]')).uploadFile(file);
    await page.waitForFunction(() =>
      document.querySelector("footer")?.textContent.includes("Opened project"),
    );
    await page.waitForSelector('button[aria-label="Select ring"]');
    expect((await native()).authoredSource).toMatch(/len\s*=\s*12/);
  }, 240000);
  test("user-written n0 modules remain authored code and imported mesh geometry still blocks Code", async () => {
    await click("＋ box");
    const initial = await toCode();
    await edit(initial + "\nmodule n0(size=8){sphere(d=size);}\nn0();");
    await beginReturn();
    await finishReturn();
    await exact();
    const code = await toCode();
    expect(code).toContain("module n0(size=8)");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.click('a[href="?studio=1"]'),
    ]);
    await ready();
    await (
      await page.$('input[aria-label="Project file"]')
    ).uploadFile(path.resolve("examples/forma3d/imported-mesh.forma3d"));
    await page.waitForSelector('button[aria-label="Select Imported cube"]');
    expect(
      await page.$eval('header a[role="link"]', (e) =>
        e.getAttribute("aria-disabled"),
      ),
    ).toBe("true");
  }, 180000);
  test("library backups import with review and another-tab updates cannot be overwritten", async () => {
    await importFlower();
    await page.click(".studio-module-library summary");
    const backup = await download("Export module library");
    const file = path.join(temp, "library.json");
    fs.writeFileSync(file, backup);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const q = indexedDB.open("forma3d-studio", 1);
          q.onsuccess = () => {
            const db = q.result,
              tx = db.transaction("projects", "readwrite");
            tx.objectStore("projects").delete("module-library");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        }),
    );
    await click("Refresh library");
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="Library module"]').options
          .length === 1,
    );
    await (
      await page.$('input[aria-label="Module library backup"]')
    ).uploadFile(file);
    await page.waitForSelector('[aria-label="Import detected modules"]');
    await click("Import selected modules");
    await page.waitForFunction(() =>
      document.querySelector("footer").textContent.includes("Saved 4 module"),
    );
    expect((await library()).entries).toHaveLength(4);
    const code = await toCode();
    await edit(code + "\nmodule extra_piece(){cube(3);}");
    await beginReturn();
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const q = indexedDB.open("forma3d-studio", 1);
          q.onsuccess = () => {
            const db = q.result,
              tx = db.transaction("projects", "readwrite"),
              store = tx.objectStore("projects"),
              r = store.get("module-library");
            r.onsuccess = () => {
              const l = r.result;
              l.revision++;
              l.entries.push({
                name: "other_tab",
                source: "module other_tab(){cube(2);}",
              });
              store.put(l, "module-library");
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        }),
    );
    await click("Save selected modules and return");
    await page.waitForFunction(() =>
      document.body.textContent.includes("library changed in another tab"),
    );
    expect(new URL(page.url()).searchParams.has("studio")).toBe(false);
    expect(await source()).toContain("module extra_piece");
    const names = (await library()).entries.map((e) => e.name);
    expect(names).toContain("other_tab");
    expect(names).not.toContain("extra_piece");
  }, 180000);
  test("invalid module syntax and external mesh dependencies stay in Code without library writes", async () => {
    await click("＋ box");
    const original = await toCode();
    for (const [bad, message] of [
      ["module broken(){this is invalid;}", "Module syntax is invalid"],
      ['module mesh_source(){import("shape.stl");}', "self-contained"],
    ]) {
      const typed = await edit(original + "\n" + bad);
      await page.click('a[href="?studio=1"]');
      await page.waitForFunction(
        (message) => document.body.textContent.includes(message),
        { timeout: 45000 },
        message,
      );
      expect(new URL(page.url()).searchParams.has("studio")).toBe(false);
      expect(await source()).toBe(typed);
      expect(await library()).toBeUndefined();
      expect(await page.$('[aria-label="Import detected modules"]')).toBeNull();
    }
  }, 120000);

  test("module calls retain active Code customizer values when entering Visual Design", async () => {
    await saved();
    const state = {
      params: {
        activePath: "/custom.scad",
        sources: [
          {
            path: "/custom.scad",
            content: "height=10; module part(h=height){cube([5,5,h]);} part();",
          },
        ],
        vars: { height: 18 },
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
    await source();
    await beginReturn();
    await finishReturn();
    await exact();
    expect((await native()).authoredSource).toMatch(/height=18/);
    expect(
      (await library()).entries.find((e) => e.name === "part").source,
    ).toMatch(/height=18/);
    const stl = await download("Export exact STL"),
      count = stl.readUInt32LE(80);
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < count; i++)
      for (let v = 0; v < 3; v++) {
        const z = stl.readFloatLE(104 + i * 50 + v * 12);
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
    expect(max - min).toBe(18);
  }, 120000);
});
