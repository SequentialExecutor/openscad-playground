// A real customizer interaction check independent of the unavailable WASM engine.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "server/package.json"))(
  "esbuild",
);
const result = await build({
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import CustomizerPanel from './src/components/CustomizerPanel';
    import {ModelContext} from './src/components/contexts';
    function Fixture() {
      const [vars,setVars]=useState({offset:10,caption:'Default label'});
      const parameters=[
        {name:'offset',type:'number',initial:10,min:0,max:20,step:1},
        {name:'caption',type:'string',initial:'Default label'}
      ].map(p=>({...p,group:'Dimensions',caption:''}));
      const model={state:{params:{vars},view:{},parameterSet:{parameters}},
        setVars:values=>setVars(v=>({...v,...values}))};
      return <ModelContext.Provider value={model as any}>
        <CustomizerPanel/><output>{JSON.stringify(vars)}</output>
      </ModelContext.Provider>;
    }
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `,
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const server = http.createServer((req, res) => {
  if (req.url === "/app.js")
    res
      .setHeader("Content-Type", "text/javascript")
      .end(result.outputFiles[0].contents);
  else
    res
      .setHeader("Content-Type", "text/html")
      .end(
        '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>',
      );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector("input[role=spinbutton]");
  const numeric = await page.$("input[role=spinbutton]");
  await numeric.focus();
  await numeric.evaluate((el) => el.select());
  await page.keyboard.type("0");
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    () => JSON.parse(document.querySelector("output").textContent).offset === 0,
    { timeout: 3000 },
  );
  assert.equal(await numeric.evaluate((el) => el.value), "0");
  const text = await page.$("input:not([role=spinbutton])");
  await text.focus();
  await text.evaluate((el) => el.select());
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("output").textContent).caption === "",
  );
  assert.equal(await text.evaluate((el) => el.value), "");
  await page.click('button[title="Reset to default"]');
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("output").textContent).offset === 10,
  );
  console.log(
    "PASS Chromium: zero input, empty text, synchronized state and reset",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
