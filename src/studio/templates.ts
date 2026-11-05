export type MechanicalSpec =
  | {
      kind: "enclosure";
      width: number;
      depth: number;
      height: number;
      wall: number;
      corner: number;
      posts: boolean;
      holes: boolean;
      postDiameter: number;
      postHeight: number;
      holeDiameter: number;
      inset: number;
    }
  | { kind: "spacer"; outer: number; inner: number; height: number }
  | {
      kind: "standoff";
      outer: number;
      inner: number;
      height: number;
      baseDiameter: number;
      baseHeight: number;
    }
  | {
      kind: "hole";
      style: "clearance" | "counterbore" | "countersink";
      diameter: number;
      clearance: number;
      depth: number;
      headDiameter: number;
      headDepth: number;
      angle: number;
    }
  | {
      kind: "mounting-tab";
      width: number;
      depth: number;
      height: number;
      corner: number;
      holeDiameter: number;
      holeX: number;
    }
  | {
      kind: "alignment-pin";
      diameter: number;
      height: number;
      tipDiameter: number;
      tipHeight: number;
    }
  | {
      kind: "snap-reference";
      length: number;
      width: number;
      thickness: number;
      latchHeight: number;
      latchLength: number;
    };
export type TemplateKind = MechanicalSpec["kind"];
export const templateNames: Record<TemplateKind, string> = {
  enclosure: "Enclosure",
  spacer: "Spacer",
  standoff: "Standoff",
  hole: "Hole cutter",
  "mounting-tab": "Mounting tab",
  "alignment-pin": "Alignment pin",
  "snap-reference": "Snap-fit reference",
};
export function defaultTemplate(kind: TemplateKind): MechanicalSpec {
  switch (kind) {
    case "enclosure":
      return {
        kind,
        width: 100,
        depth: 60,
        height: 30,
        wall: 3,
        corner: 5,
        posts: false,
        holes: false,
        postDiameter: 8,
        postHeight: 6,
        holeDiameter: 3,
        inset: 10,
      };
    case "spacer":
      return { kind, outer: 10, inner: 5, height: 5 };
    case "standoff":
      return {
        kind,
        outer: 8,
        inner: 3,
        height: 10,
        baseDiameter: 12,
        baseHeight: 2,
      };
    case "hole":
      return {
        kind,
        style: "clearance",
        diameter: 3,
        clearance: 0.2,
        depth: 20,
        headDiameter: 6.5,
        headDepth: 3,
        angle: 90,
      };
    case "mounting-tab":
      return {
        kind,
        width: 20,
        depth: 12,
        height: 4,
        corner: 2,
        holeDiameter: 4,
        holeX: 4,
      };
    case "alignment-pin":
      return { kind, diameter: 5, height: 10, tipDiameter: 4, tipHeight: 2 };
    case "snap-reference":
      return {
        kind,
        length: 20,
        width: 8,
        thickness: 2,
        latchHeight: 1,
        latchLength: 3,
      };
  }
}
// Rounded template profiles use 64 segments. Check the mounting disk against
// the cavity's straight sides and each first-quadrant corner segment; symmetry
// gives the same clearance at all four mounting positions.
function mountingPostsFit(
  t: Extract<MechanicalSpec, { kind: "enclosure" }>,
): boolean {
  const radius = Math.max(0, t.corner - t.wall),
    postRadius = t.postDiameter / 2;
  if (t.inset - t.wall < postRadius) return false;
  return Array.from({ length: 16 }, (_, i) => {
    const angle = ((i + 0.5) * Math.PI) / 32;
    const clearance =
      radius * Math.cos(Math.PI / 64) +
      (t.inset - t.wall - radius) * (Math.cos(angle) + Math.sin(angle));
    return clearance + 1e-9 >= postRadius;
  }).every(Boolean);
}
export function validateTemplate(t: MechanicalSpec): MechanicalSpec {
  if (!t || !Object.hasOwn(templateNames, t.kind))
    throw Error("Unknown mechanical template.");
  const positive = (...values: number[]) => {
    if (!values.every((n) => Number.isFinite(n) && n >= 0.001 && n <= 1e6))
      throw Error("Template dimensions must be in [0.001, 1000000] mm.");
  };
  const zero = (...values: number[]) => {
    if (!values.every((n) => Number.isFinite(n) && n >= 0 && n <= 1e6))
      throw Error("Template dimensions cannot be negative.");
  };
  switch (t.kind) {
    case "enclosure":
      positive(
        t.width,
        t.depth,
        t.height,
        t.wall,
        t.postDiameter,
        t.postHeight,
        t.holeDiameter,
        t.inset,
      );
      zero(t.corner);
      if (
        typeof t.posts !== "boolean" ||
        typeof t.holes !== "boolean" ||
        (t.holes && !t.posts) ||
        t.wall * 2 >= Math.min(t.width, t.depth) ||
        t.wall >= t.height ||
        t.corner >= Math.min(t.width, t.depth) / 2 ||
        (t.posts &&
          (!mountingPostsFit(t) ||
            2 * t.inset + t.postDiameter >= Math.min(t.width, t.depth) ||
            t.postHeight + t.wall > t.height ||
            t.holeDiameter >= t.postDiameter))
      )
        throw Error(
          "Invalid enclosure dimensions: mounting posts must fit inside the cavity, including rounded corners. Enable posts before holes.",
        );
      return {
        kind: t.kind,
        width: t.width,
        depth: t.depth,
        height: t.height,
        wall: t.wall,
        corner: t.corner,
        posts: t.posts,
        holes: t.holes,
        postDiameter: t.postDiameter,
        postHeight: t.postHeight,
        holeDiameter: t.holeDiameter,
        inset: t.inset,
      };
    case "spacer":
    case "standoff":
      positive(t.outer, t.height);
      zero(t.inner);
      if (t.inner >= t.outer)
        throw Error("Bore must be smaller than the outer diameter.");
      if (t.kind === "standoff") {
        positive(t.baseDiameter, t.baseHeight);
        if (t.baseDiameter < t.outer || t.baseHeight > t.height)
          throw Error("Standoff base must fit the post.");
        return {
          kind: t.kind,
          outer: t.outer,
          inner: t.inner,
          height: t.height,
          baseDiameter: t.baseDiameter,
          baseHeight: t.baseHeight,
        };
      }
      return { kind: t.kind, outer: t.outer, inner: t.inner, height: t.height };
    case "hole":
      positive(t.diameter, t.depth, t.headDiameter, t.headDepth);
      zero(t.clearance);
      if (
        !["clearance", "counterbore", "countersink"].includes(t.style) ||
        !Number.isFinite(t.angle) ||
        t.angle < 10 ||
        t.angle > 170
      )
        throw Error("Invalid hole style or countersink angle.");
      if (
        t.style !== "clearance" &&
        (t.headDiameter <= t.diameter + t.clearance ||
          (t.style === "counterbore" && t.headDepth > t.depth) ||
          (t.style === "countersink" &&
            (t.headDiameter - t.diameter - t.clearance) /
              2 /
              Math.tan((t.angle * Math.PI) / 360) >
              t.depth))
      )
        throw Error("Head recess must fit the shaft and depth.");
      return {
        kind: t.kind,
        style: t.style,
        diameter: t.diameter,
        clearance: t.clearance,
        depth: t.depth,
        headDiameter: t.headDiameter,
        headDepth: t.headDepth,
        angle: t.angle,
      };
    case "mounting-tab":
      positive(t.width, t.depth, t.height, t.holeDiameter);
      zero(t.corner);
      if (
        !Number.isFinite(t.holeX) ||
        Math.abs(t.holeX) + t.holeDiameter / 2 >= t.width / 2 - t.corner ||
        t.holeDiameter >= t.depth ||
        t.corner >= Math.min(t.width, t.depth) / 2
      )
        throw Error("Tab hole must fit inside the straight-sided region.");
      return {
        kind: t.kind,
        width: t.width,
        depth: t.depth,
        height: t.height,
        corner: t.corner,
        holeDiameter: t.holeDiameter,
        holeX: t.holeX,
      };
    case "alignment-pin":
      positive(t.diameter, t.height, t.tipDiameter, t.tipHeight);
      if (t.tipDiameter > t.diameter || t.tipHeight >= t.height)
        throw Error("Pin taper must fit its shaft.");
      return {
        kind: t.kind,
        diameter: t.diameter,
        height: t.height,
        tipDiameter: t.tipDiameter,
        tipHeight: t.tipHeight,
      };
    case "snap-reference":
      positive(t.length, t.width, t.thickness, t.latchHeight, t.latchLength);
      if (t.latchLength >= t.length)
        throw Error("Latch must be shorter than its beam.");
      return {
        kind: t.kind,
        length: t.length,
        width: t.width,
        thickness: t.thickness,
        latchHeight: t.latchHeight,
        latchLength: t.latchLength,
      };
  }
}
const rounded = (w: number, d: number, r: number) =>
  r > 0
    ? `offset(r=${r}) square([${w - 2 * r},${d - 2 * r}],center=true);`
    : `square([${w},${d}],center=true);`;
export function templateSize(t: MechanicalSpec): [number, number, number] {
  switch (t.kind) {
    case "enclosure":
    case "mounting-tab":
      return [t.width, t.depth, t.height];
    case "spacer":
      return [t.outer, t.outer, t.height];
    case "standoff":
      return [t.baseDiameter, t.baseDiameter, t.height];
    case "hole":
      return [
        t.style === "clearance" ? t.diameter + t.clearance : t.headDiameter,
        t.style === "clearance" ? t.diameter + t.clearance : t.headDiameter,
        t.depth,
      ];
    case "alignment-pin":
      return [t.diameter, t.diameter, t.height];
    case "snap-reference":
      return [t.length, t.width, t.thickness + t.latchHeight];
  }
}
export function templateScad(t: MechanicalSpec): string {
  validateTemplate(t);
  switch (t.kind) {
    case "enclosure": {
      const positions = `for(x=[-${t.width / 2 - t.inset},${t.width / 2 - t.inset}],y=[-${t.depth / 2 - t.inset},${t.depth / 2 - t.inset}])`;
      return `difference(){union(){difference(){linear_extrude(${t.height}){${rounded(t.width, t.depth, t.corner)}} translate([0,0,${t.wall}]) linear_extrude(${t.height}){${rounded(t.width - 2 * t.wall, t.depth - 2 * t.wall, Math.max(0, t.corner - t.wall))}}} ${t.posts ? `${positions} translate([x,y,${t.wall - 0.001}]) cylinder(d=${t.postDiameter},h=${t.postHeight + 0.001});` : ""}} ${t.posts && t.holes ? `${positions} translate([x,y,0]) cylinder(d=${t.holeDiameter},h=${t.wall + t.postHeight});` : ""}}`;
    }
    case "spacer":
    case "standoff":
      return `difference(){union(){cylinder(d=${t.outer},h=${t.height});${t.kind === "standoff" ? `cylinder(d=${t.baseDiameter},h=${t.baseHeight});` : ""}}${t.inner > 0 ? `cylinder(d=${t.inner},h=${t.height});` : ""}}`;
    case "hole": {
      const d = t.diameter + t.clearance,
        h = (t.headDiameter - d) / 2 / Math.tan((t.angle * Math.PI) / 360);
      return `union(){cylinder(d=${d},h=${t.depth});${t.style === "counterbore" ? `translate([0,0,${t.depth - t.headDepth}]) cylinder(d=${t.headDiameter},h=${t.headDepth});` : t.style === "countersink" ? `translate([0,0,${t.depth - h}]) cylinder(d1=${d},d2=${t.headDiameter},h=${h});` : ""}}`;
    }
    case "mounting-tab":
      return `difference(){linear_extrude(${t.height}){${rounded(t.width, t.depth, t.corner)}} translate([${t.holeX},0,0]) cylinder(d=${t.holeDiameter},h=${t.height});}`;
    case "alignment-pin":
      return `union(){cylinder(d=${t.diameter},h=${t.height - t.tipHeight});translate([0,0,${t.height - t.tipHeight}]) cylinder(d1=${t.diameter},d2=${t.tipDiameter},h=${t.tipHeight});}`;
    case "snap-reference": {
      const x = t.length - t.latchLength,
        y = t.width / 2,
        z = t.thickness;
      return `union(){translate([0,-${y},0]) cube([${t.length},${t.width},${z}]);polyhedron(points=[[${x},-${y},${z}],[${t.length},-${y},${z}],[${x},-${y},${z + t.latchHeight}],[${x},${y},${z}],[${t.length},${y},${z}],[${x},${y},${z + t.latchHeight}]],faces=[[0,2,1],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]]);}`;
    }
  }
}
