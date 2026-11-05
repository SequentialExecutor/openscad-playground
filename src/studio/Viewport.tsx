import { meshInfo } from "./mesh-asset";
import React, { useEffect, useRef } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import {
  Body,
  Design,
  Vec3,
  rootNodes,
  Transformable,
  isTransformable,
} from "./document";

export interface ViewportProps {
  design: Design;
  featureMeshes: Record<string, ArrayBuffer>;
  selected?: string;
  mode: "translate" | "rotate" | "scale";
  snap: boolean;
  cameraView: "iso" | "top" | "front" | "right";
  orthographic: boolean;
  fit: number;
  onSelect: (id?: string) => void;
  onDraft: (body?: Transformable) => void;
  onCommit: (body: Transformable) => void;
}
export default function Viewport(props: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const runtime = useRef<ReturnType<typeof setup> | undefined>(undefined);
  function setup(element: HTMLDivElement) {
    const scene = new T.Scene();
    scene.background = new T.Color("#151c28");
    const camera = latest.current.orthographic
      ? new T.OrthographicCamera(-75, 75, 75, -75, 0.1, 10000)
      : new T.PerspectiveCamera(42, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(110, -150, 110);
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-label", "Interactive 3D workspace");
    renderer.domElement.tabIndex = 0;
    element.appendChild(renderer.domElement);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, 10);
    const light = new T.HemisphereLight(0xffffff, 0x596079, 2.8);
    scene.add(light);
    const sun = new T.DirectionalLight(0xffffff, 3);
    sun.position.set(60, -80, 120);
    scene.add(sun);
    const grid = new T.GridHelper(220, 22, 0x64748b, 0x303c50);
    grid.rotateX(Math.PI / 2);
    scene.add(grid);
    const buildVolume = new T.Box3Helper(new T.Box3(), 0x546b80);
    scene.add(buildVolume);
    const axes = new T.AxesHelper(35);
    scene.add(axes);
    const solids = new T.Group();
    scene.add(solids);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.85);
    scene.add(gizmo.getHelper());
    let dragging = false,
      cancelled = false,
      initial: Transformable | undefined;
    const cloneBody = () => {
      const body = [
        ...latest.current.design.bodies,
        ...latest.current.design.features,
      ]
        .filter(isTransformable)
        .find((b) => b.id === gizmo.object?.userData.id);
      return body ? structuredClone(body) : undefined;
    };
    const readBody = (): Transformable | undefined => {
      const o = gizmo.object;
      const b = initial ?? cloneBody();
      if (!b || !o) return;
      const r = new T.Euler().setFromQuaternion(o.quaternion, "ZYX");
      return {
        ...b,
        position: o.position.toArray() as Vec3,
        rotation: [r.x, r.y, r.z].map(T.MathUtils.radToDeg) as Vec3,
        scale: o.scale.toArray().map((n) => Math.max(0.001, n)) as Vec3,
      };
    };
    const setTransform = (o: T.Object3D, b: Transformable) => {
      o.position.fromArray(b.position);
      o.rotation.set(...(b.rotation.map(T.MathUtils.degToRad) as Vec3), "ZYX");
      o.scale.fromArray(b.scale);
    };
    gizmo.addEventListener("dragging-changed", (e) => {
      dragging = !!e.value;
      orbit.enabled = !dragging;
      if (dragging) {
        initial = cloneBody();
        cancelled = false;
      } else {
        if (cancelled && initial && gizmo.object)
          setTransform(gizmo.object, initial);
        const b = readBody();
        if (!cancelled && b) latest.current.onCommit(b);
        latest.current.onDraft(undefined);
        initial = undefined;
      }
    });
    gizmo.addEventListener("objectChange", () => {
      if (dragging && !cancelled) latest.current.onDraft(readBody());
    });
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragging && initial && gizmo.object) {
        cancelled = true;
        setTransform(gizmo.object, initial);
        latest.current.onDraft(undefined);
      }
    };
    window.addEventListener("keydown", cancel);
    const ray = new T.Raycaster();
    let downX = 0,
      downY = 0;
    const down = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        gizmo.axis ||
        dragging ||
        Math.hypot(e.clientX - downX, e.clientY - downY) > 4
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new T.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(solids.children)[0];
      latest.current.onSelect(hit?.object.userData.id);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    let resizeFrame = 0,
      lastWidth = 0,
      lastHeight = 0;
    const applyResize = () => {
      const w = element.clientWidth,
        h = element.clientHeight;
      if (!w || !h || (w === lastWidth && h === lastHeight)) return;
      lastWidth = w;
      lastHeight = h;
      // CSS owns layout. Updating the drawing buffer must not resize its host.
      renderer.setSize(w, h, false);
      if (camera instanceof T.PerspectiveCamera) camera.aspect = w / h;
      else {
        const half = (camera.top - camera.bottom) / 2;
        camera.left = (-half * w) / h;
        camera.right = (half * w) / h;
      }
      camera.updateProjectionMatrix();
    };
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(applyResize);
    });
    resize.observe(element);
    const clear = () => {
      gizmo.detach();
      for (const child of [...solids.children]) {
        const mesh = child as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
        mesh.geometry.dispose();
        mesh.material.dispose();
        solids.remove(mesh);
      }
    };
    const refresh = () => {
      if (dragging) return;
      clear();
      const build = latest.current.design.print.build;
      buildVolume.box.set(
        new T.Vector3(-build[0] / 2, -build[1] / 2, 0),
        new T.Vector3(build[0] / 2, build[1] / 2, build[2]),
      );
      const roots = new Set(
        rootNodes(latest.current.design).map((node) => node.id),
      );
      for (const b of latest.current.design.bodies.filter(
        (b) =>
          b.kind !== "extrusion" &&
          b.kind !== "template" &&
          b.kind !== "mesh" &&
          b.visible &&
          (roots.has(b.id) || b.id === latest.current.selected),
      )) {
        const g =
          b.kind === "box"
            ? new T.BoxGeometry(...b.size)
            : b.kind === "sphere"
              ? new T.SphereGeometry(1, 48, 24)
              : new T.CylinderGeometry(
                  b.kind === "cone" ? 0 : 1,
                  1,
                  b.size[2],
                  64,
                );
        if (b.kind === "sphere") g.scale(...(b.size.map((n) => n / 2) as Vec3));
        else if (b.kind !== "box") {
          g.rotateX(Math.PI / 2);
          g.scale(b.size[0] / 2, b.size[1] / 2, 1);
        }
        const m = new T.Mesh(
          g,
          new T.MeshStandardMaterial({
            color: b.id === latest.current.selected ? 0xffbe55 : 0x6ca7cc,
            wireframe: !roots.has(b.id),
            transparent: !roots.has(b.id),
            opacity: roots.has(b.id) ? 1 : 0.5,
            roughness: 0.55,
            metalness: 0.12,
          }),
        );
        m.userData.id = b.id;
        setTransform(m, b);
        solids.add(m);
        if (b.id === latest.current.selected && !b.locked) gizmo.attach(m);
      }
      for (const b of latest.current.design.bodies.filter(
        (b) =>
          b.kind === "mesh" &&
          b.visible &&
          (roots.has(b.id) || b.id === latest.current.selected),
      )) {
        const a = latest.current.design.meshAssets.find(
          (a) => a.id === b.meshAssetId,
        )!;
        const g = new STLLoader().parse(meshInfo(a).data);
        g.computeVertexNormals();
        const m = new T.Mesh(
          g,
          new T.MeshStandardMaterial({
            color: b.id === latest.current.selected ? 0xffbe55 : 0x6ca7cc,
            side: T.DoubleSide,
            wireframe: !roots.has(b.id),
            transparent: !roots.has(b.id),
            opacity: roots.has(b.id) ? 1 : 0.5,
            roughness: 0.55,
            metalness: 0.12,
          }),
        );
        m.userData.id = b.id;
        setTransform(m, b);
        solids.add(m);
        if (b.id === latest.current.selected && !b.locked) gizmo.attach(m);
      }
      for (const [id, data] of Object.entries(latest.current.featureMeshes)) {
        const geometry = new STLLoader().parse(data);
        const mesh = new T.Mesh(
          geometry,
          new T.MeshStandardMaterial({
            color: id === latest.current.selected ? 0xffbe55 : 0x6ca7cc,
            roughness: 0.55,
            metalness: 0.12,
          }),
        );
        const body = [
          ...latest.current.design.bodies,
          ...latest.current.design.features,
        ]
          .filter(isTransformable)
          .find((b) => b.id === id);
        if (body) {
          setTransform(mesh, body);
          if (!roots.has(id)) {
            mesh.material.wireframe = true;
            mesh.material.transparent = true;
            mesh.material.opacity = 0.5;
          }
          if (id === latest.current.selected && !body.locked)
            gizmo.attach(mesh);
        }
        mesh.userData.id = id;
        solids.add(mesh);
      }
      gizmo.setMode(latest.current.mode);
      gizmo.setTranslationSnap(latest.current.snap ? 1 : null);
      gizmo.setRotationSnap(latest.current.snap ? Math.PI / 12 : null);
      gizmo.setScaleSnap(latest.current.snap ? 0.1 : null);
    };
    const view = () => {
      const box = new T.Box3().setFromObject(solids);
      const center = box.isEmpty()
        ? new T.Vector3()
        : box.getCenter(new T.Vector3());
      const distance = Math.max(
        box.isEmpty() ? 100 : box.getSize(new T.Vector3()).length() * 1.8,
        40,
      );
      const v = latest.current.cameraView;
      const direction =
        v === "top"
          ? new T.Vector3(0, -0.001, 1)
          : v === "front"
            ? new T.Vector3(0, -1, 0)
            : v === "right"
              ? new T.Vector3(1, 0, 0)
              : new T.Vector3(1, -1, 0.8).normalize();
      if (camera instanceof T.OrthographicCamera) {
        const half = distance * 0.45;
        const aspect = element.clientWidth / element.clientHeight;
        camera.top = half;
        camera.bottom = -half;
        camera.left = -half * aspect;
        camera.right = half * aspect;
        camera.zoom = 1;
        camera.updateProjectionMatrix();
      }
      orbit.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      orbit.update();
    };
    renderer.setAnimationLoop(() => {
      orbit.update();
      renderer.render(scene, camera);
    });
    return {
      refresh,
      view,
      dispose: () => {
        renderer.setAnimationLoop(null);
        resize.disconnect();
        cancelAnimationFrame(resizeFrame);
        window.removeEventListener("keydown", cancel);
        renderer.domElement.removeEventListener("pointerdown", down);
        renderer.domElement.removeEventListener("pointerup", up);
        clear();
        gizmo.dispose();
        orbit.dispose();
        grid.geometry.dispose();
        (grid.material as T.Material).dispose();
        buildVolume.geometry.dispose();
        (buildVolume.material as T.Material).dispose();
        axes.geometry.dispose();
        (axes.material as T.Material).dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    };
  }
  const [error, setError] = React.useState("");
  useEffect(() => {
    try {
      runtime.current = setup(host.current!);
      runtime.current.refresh();
      runtime.current.view();
    } catch (e) {
      setError(`Unable to start WebGL: ${e}`);
    }
    return () => {
      runtime.current?.dispose();
      runtime.current = undefined;
    };
  }, [props.orthographic]);
  useEffect(
    () => runtime.current?.refresh(),
    [props.design, props.selected, props.mode, props.snap, props.featureMeshes],
  );
  useEffect(() => runtime.current?.view(), [props.cameraView, props.fit]);
  return (
    <div className="studio-canvas" ref={host}>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
