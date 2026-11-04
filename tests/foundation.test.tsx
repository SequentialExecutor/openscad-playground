import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import CustomizerPanel from "../src/components/CustomizerPanel";
import { ModelContext } from "../src/components/contexts";
import { export3MF } from "../src/io/export_3mf";
import type { IndexedPolyhedron } from "../src/io/common";

const tetrahedron: IndexedPolyhedron = {
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 0, y: 10, z: 0 },
    { x: 0, y: 0, z: 10 },
  ],
  faces: [
    [0, 2, 1],
    [0, 1, 3],
    [1, 2, 3],
    [2, 0, 3],
  ].map((vertices) => ({
    vertices: vertices as [number, number, number],
    colorIndex: 0,
  })),
  colors: [[1, 0, 0, 1]],
};

test("3MF package preserves geometry, millimeters, relationships and valid production UUIDs", async () => {
  const blob = export3MF(tetrahedron);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer(), {
    checkCRC32: true,
  });
  const xml = await zip.file("3D/3dmodel.model")!.async("string");
  assert.match(xml, /unit="millimeter"/);
  assert.equal([...xml.matchAll(/<vertex /g)].length, 4);
  assert.equal([...xml.matchAll(/<triangle /g)].length, 4);
  for (const [i, v] of tetrahedron.vertices.entries()) {
    assert.ok(
      xml.includes(`<vertex x="${v.x}" y="${v.y}" z="${v.z}" />`),
      `vertex ${i}`,
    );
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ids = [...xml.matchAll(/p:UUID="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 3);
  for (const id of ids) assert.match(id, uuid);
  assert.equal(ids[0], ids[2], "build item refers to the object UUID");
  assert.notEqual(ids[0], ids[1]);
  assert.match(
    await zip.file("_rels/.rels")!.async("string"),
    /Target="\/3D\/3dmodel.model"/,
  );
  assert.match(
    await zip.file("[Content_Types].xml")!.async("string"),
    /Extension="model"/,
  );
});

test("customizer preserves zero and empty string overrides in actual controls", () => {
  const parameters = [
    { name: "offset", type: "number", initial: 10, min: 0, max: 20, step: 1 },
    { name: "caption", type: "string", initial: "Default label" },
  ].map((p) => ({ ...p, group: "Dimensions", caption: "" }));
  const model = {
    state: {
      parameterSet: { parameters },
      params: { vars: { offset: 0, caption: "" } },
      view: {},
    },
  };
  const html = renderToStaticMarkup(
    <ModelContext.Provider value={model as any}>
      <CustomizerPanel />
    </ModelContext.Provider>,
  );
  assert.match(html, /aria-valuenow="0"/);
  assert.doesNotMatch(html, /value="10"/);
  assert.doesNotMatch(html, /value="Default label"/);
});

test("customizer uses initial values when there is no override", () => {
  const model = {
    state: {
      parameterSet: {
        parameters: [
          {
            name: "offset",
            type: "number",
            initial: 10,
            group: "Dimensions",
            caption: "",
          },
        ],
      },
      params: { vars: {} },
      view: {},
    },
  };
  const html = renderToStaticMarkup(
    <ModelContext.Provider value={model as any}>
      <CustomizerPanel />
    </ModelContext.Provider>,
  );
  assert.match(html, /value="10"/);
});
