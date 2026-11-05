const base = process.env.E2E_BASE_URL ?? "http://localhost:4000/";
const readRecovery = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("forma3d-studio", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("projects")
            .objectStore("projects")
            .get("recovery");
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => {
            reject(read.error);
            db.close();
          };
        };
      }),
  );
const click = async (page, label) => {
  const button = await page.evaluateHandle(
    (label) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === label,
      ),
    label,
  );
  await button.asElement().click();
  await button.dispose();
};
const saved = (page) =>
  page.waitForFunction(() =>
    document.querySelector("footer")?.textContent.includes("Saved locally"),
  );
describe("Recovery failure protection", () => {
  let context, page;
  beforeEach(async () => {
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.goto(`${base}?studio=1`);
    await page.waitForFunction(
      () => document.querySelector("button")?.disabled === false,
    );
    await click(page, "＋ box");
    await page.waitForSelector('button[aria-label="Select Box"]');
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await saved(page);
    expect((await readRecovery(page)).bodies).toHaveLength(1);
  }, 15000);
  afterEach(async () => {
    await context?.close();
  }, 15000);
  test.each(["read error", "invalid document"])(
    "%s preserves stored recovery through edits and allows a later successful recovery",
    async (failure) => {
      const valid = await readRecovery(page);
      let stored = valid;
      if (failure === "read error") {
        await page.evaluateOnNewDocument(() => {
          const get = IDBObjectStore.prototype.get;
          let fail = true;
          IDBObjectStore.prototype.get = function (key) {
            if (fail && this.name === "projects" && key === "recovery") {
              fail = false;
              const request = {
                error: new DOMException("Simulated recovery read failure"),
                onerror: null,
              };
              setTimeout(() => request.onerror?.(), 0);
              return request;
            }
            return get.call(this, key);
          };
        });
      } else {
        stored = { version: 999, note: "Preserve this record for recovery" };
        await page.evaluate(
          (data) =>
            new Promise((resolve, reject) => {
              const r = indexedDB.open("forma3d-studio", 1);
              r.onsuccess = () => {
                const db = r.result,
                  tx = db.transaction("projects", "readwrite");
                tx.objectStore("projects").put(data, "recovery");
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => reject(tx.error);
              };
            }),
          stored,
        );
      }
      await page.reload();
      await page.waitForFunction(() =>
        document
          .querySelector("footer")
          ?.textContent.includes("Local autosave paused"),
      );
      // Wait longer than the actual debounce, then confirm startup did not overwrite.
      await page.waitForFunction(
        () => document.querySelector("button")?.disabled === false,
      );
      await new Promise((r) => setTimeout(r, 700));
      expect(await readRecovery(page)).toEqual(stored);
      await click(page, "＋ sphere");
      await page.waitForSelector('button[aria-label="Select Sphere"]');
      await new Promise((r) => setTimeout(r, 700));
      expect(await readRecovery(page)).toEqual(stored);
      // Paused autosave must not prevent explicit native project downloads.
      await page.evaluate(() => {
        HTMLAnchorElement.prototype.click = function () {
          fetch(this.href)
            .then((r) => r.arrayBuffer())
            .then(
              (b) => (window.recoveryDownload = Array.from(new Uint8Array(b))),
            );
        };
      });
      await click(page, "Save project");
      await page.waitForFunction(() => window.recoveryDownload?.length > 0);
      const zip = await require("jszip").loadAsync(
        Buffer.from(await page.evaluate(() => window.recoveryDownload)),
      );
      expect(
        JSON.parse(await zip.file("project.json").async("string")).bodies[0]
          .kind,
      ).toBe("sphere");
      // Unsaved edits are protected when leaving this session.
      let warned = false;
      page.once("dialog", async (d) => {
        warned = d.type() === "beforeunload";
        await d.accept();
      });
      // Restore the initial valid record for the invalid-schema case; remove the
      // one-shot read fault for the transient-error case before the next startup.
      if (failure === "invalid document")
        await page.evaluate(
          (data) =>
            new Promise((resolve, reject) => {
              const r = indexedDB.open("forma3d-studio", 1);
              r.onsuccess = () => {
                const db = r.result,
                  tx = db.transaction("projects", "readwrite");
                tx.objectStore("projects").put(data, "recovery");
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => reject(tx.error);
              };
            }),
          valid,
        );
      // A fresh page removes the injected fault and reloads the original design.
      await page.goto("about:blank");
      expect(warned).toBe(true);
      await page.close();
      page = await context.newPage();
      await page.goto(`${base}?studio=1`);
      await page.waitForSelector('button[aria-label="Select Box"]');
      await saved(page);
      expect((await readRecovery(page)).bodies[0].id).toBe(valid.bodies[0].id);
      await click(page, "＋ cylinder");
      await page.waitForSelector('button[aria-label="Select Cylinder"]');
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      await saved(page);
      expect((await readRecovery(page)).bodies).toHaveLength(2);
    },
    45000,
  );
});
