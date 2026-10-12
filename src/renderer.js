/**
 * Small, dependency-free technical illustration renderer.
 *
 * All geometry uses millimetres. Keeping the projection here (rather than in
 * pointer handlers) means dragging and rendering always agree about position.
 * The artwork is intentionally an illustration, not a mechanical/CAD model.
 */

import { WORKSPACE } from "./workspace.js";

let renderNumber = 0;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 680;
const HUMAN_HEIGHT_MM = 1828.8;
const SOCCER_DIAMETER_MM = 220;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
const number = (value) => Number(value).toFixed(2);

function findModel(catalog, id) {
  return Array.isArray(catalog)
    ? catalog.find((model) => model.id === id)
    : catalog[id];
}

function sizeOf(model, rotated = false) {
  const dimensions = model.external || model.dimensions;
  return rotated ? [dimensions[1], dimensions[0], dimensions[2]] : dimensions;
}

function itemsWithModels(boxes, catalog) {
  return boxes.flatMap((box) => {
    const model = findModel(catalog, box.modelId);
    if (!model) return [];
    const [length, width, height] = sizeOf(model, box.rotated);
    return [
      {
        ...box,
        x: box.x || 0,
        y: box.y || 0,
        z: box.z || 0,
        model,
        length,
        width,
        height,
      },
    ];
  });
}

function projection(view) {
  if (view === "top") return { xx: 1, xy: 0, yx: 0, yy: -1, zy: 0 };
  if (view === "front") return { xx: 1, xy: 0, yx: 0, yy: 0, zy: -1 };
  // A low, architectural perspective keeps capacities and proportions legible.
  return { xx: 0.98, xy: -0.055, yx: -0.44, yy: -0.25, zy: -1 };
}

function humanPosition(items) {
  return {
    x:
      (items.length
        ? Math.max(...items.map((item) => item.x + item.length))
        : 1200) + 650,
    y: items.length ? Math.min(...items.map((item) => item.y)) : 0,
  };
}

function soccerPosition(items) {
  const person = humanPosition(items);
  return { x: person.x + 500, y: person.y + 120 };
}

/**
 * Establish occlusion from separating planes, rather than base elevation.
 * The isometric camera sees the minimum x/y faces and maximum z faces. A
 * right-hand case therefore goes behind a left-hand case whenever their
 * heights overlap—even when the right-hand case starts higher in the stack.
 * Conflicting separating directions mean the silhouettes cannot overlap.
 */
function orderForDrawing(items, view) {
  const edges = items.map(() => new Set());
  const incoming = items.map(() => 0);
  const tolerance = 0.001;
  const separation = (a, aSize, b, bSize) => {
    if (a + aSize <= b + tolerance) return -1;
    if (b + bSize <= a + tolerance) return 1;
    return 0;
  };
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      const a = items[first];
      const b = items[second];
      const x = separation(a.x, a.length, b.x, b.length);
      const y = separation(a.y, a.width, b.y, b.width);
      const z = separation(a.z, a.height, b.z, b.height);
      let directions;
      if (view === "top") {
        if (x || y) continue;
        directions = [z];
      } else if (view === "front") {
        if (x || z) continue;
        directions = [-y];
      } else {
        directions = [-x, -y, z];
      }
      const before = directions.includes(-1);
      const after = directions.includes(1);
      if (before === after) continue;
      const [back, front] = before ? [first, second] : [second, first];
      edges[back].add(front);
      incoming[front] += 1;
    }
  }
  const depth = (item) => {
    const x = item.x + item.length / 2;
    const y = item.y + item.width / 2;
    const z = item.z + item.height / 2;
    return view === "top"
      ? z
      : view === "front"
        ? -y
        : -0.449 * x - y + 0.275 * z;
  };
  const remaining = new Set(items.map((_, index) => index));
  const ordered = [];
  while (remaining.size) {
    const available = [...remaining].filter((index) => incoming[index] === 0);
    // Imported intersecting layouts may produce a cycle. Keep those visible
    // and deterministic; the geometry validator reports the invalid layout.
    const choices = available.length ? available : [...remaining];
    choices.sort(
      (a, b) =>
        depth(items[a]) - depth(items[b]) ||
        String(items[a].id).localeCompare(String(items[b].id)),
    );
    const next = choices[0];
    remaining.delete(next);
    ordered.push(items[next]);
    for (const front of edges[next]) incoming[front] -= 1;
  }
  return ordered;
}

/**
 * Return the exact transform used by renderScene. Pointer coordinates supplied
 * to unproject must be in SVG viewBox units, not browser/client pixels.
 * Front view has no depth axis, so its inverse returns y=0.
 */
export function getSceneTransform(boxes, catalog, view = "iso", options = {}) {
  const axes = projection(view);
  const items = itemsWithModels(boxes, catalog);
  const raw = (x, y, z) => ({
    x: x * axes.xx + y * axes.yx,
    y: x * axes.xy + y * axes.yy + z * axes.zy,
  });
  const points = [];
  for (const box of items) {
    for (const x of [box.x, box.x + box.length]) {
      for (const y of [box.y, box.y + box.width]) {
        for (const z of [box.z, box.z + box.height]) points.push(raw(x, y, z));
      }
    }
  }
  // Frame the objects being compared, not the empty planning floor. Workspace
  // limits govern placement independently; offscreen floor is cropped by the
  // canvas. Selection and dimension annotations never enter these bounds.
  if (!points.length) points.push(raw(0, 0, 0), raw(1200, 600, 650));
  if (options.humanScale !== false) {
    const person = humanPosition(items);
    const base = raw(person.x, person.y, 0);
    // A billboard uses the same millimetre scale as vertical case edges.
    // The top view uses a shoulder/head footprint instead of standing height.
    points.push(
      {
        x: base.x - 400,
        y: base.y - (view === "top" ? 300 : HUMAN_HEIGHT_MM + 60),
      },
      { x: base.x + 700, y: base.y + (view === "top" ? 300 : 110) },
    );
  }
  if (options.soccerScale) {
    const ball = soccerPosition(items);
    const center = raw(ball.x, ball.y, SOCCER_DIAMETER_MM / 2);
    const radius = SOCCER_DIAMETER_MM / 2;
    points.push(
      { x: center.x - radius - 70, y: center.y - radius },
      { x: center.x + radius + 70, y: center.y + radius + 140 },
    );
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const scale = Math.min(
    884 / Math.max(maxX - minX, 1),
    480 / Math.max(maxY - minY, 1),
    1.15,
  );
  const offsetX = (VIEWBOX_WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY =
    (VIEWBOX_HEIGHT - (maxY - minY) * scale) / 2 - minY * scale - 9;
  const project = (x, y, z = 0) => {
    const point = raw(x, y, z);
    return { x: point.x * scale + offsetX, y: point.y * scale + offsetY };
  };
  const unproject = (svgX, svgY, z = 0) => {
    const screenX = (svgX - offsetX) / scale;
    const screenY = (svgY - offsetY) / scale - z * axes.zy;
    const determinant = axes.xx * axes.yy - axes.yx * axes.xy;
    if (Math.abs(determinant) < 0.0001) return { x: screenX / axes.xx, y: 0 };
    return {
      x: (screenX * axes.yy - axes.yx * screenY) / determinant,
      y: (axes.xx * screenY - screenX * axes.xy) / determinant,
    };
  };
  return {
    project,
    unproject,
    scale,
    width: VIEWBOX_WIDTH,
    height: VIEWBOX_HEIGHT,
  };
}

function definitions(prefix) {
  return `<defs>
    <linearGradient id="${prefix}-front" x1="0" y1="0" x2=".85" y2="1">
      <stop offset="0" stop-color="#f3f5f5"/><stop offset=".35" stop-color="#dce1e3"/>
      <stop offset=".72" stop-color="#c9cfd2"/><stop offset="1" stop-color="#bbc2c6"/>
    </linearGradient>
    <linearGradient id="${prefix}-side" x1="0" y1="0" x2="1" y2=".5">
      <stop stop-color="#aab4ba"/><stop offset=".45" stop-color="#c3cacf"/><stop offset="1" stop-color="#a4afb6"/>
    </linearGradient>
    <linearGradient id="${prefix}-lid" x1="0" y1="0" x2=".3" y2="1">
      <stop stop-color="#eef1f2"/><stop offset=".45" stop-color="#e0e5e7"/><stop offset="1" stop-color="#c8d0d4"/>
    </linearGradient>
    <linearGradient id="${prefix}-rail" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#f7f9fa"/><stop offset=".25" stop-color="#dce1e4"/>
      <stop offset=".55" stop-color="#a8b4bd"/><stop offset="1" stop-color="#c8d0d5"/>
    </linearGradient>
    <linearGradient id="${prefix}-hardware" x1="0" y1="0" x2="1" y2="0">
      <stop stop-color="#8999a3"/><stop offset=".22" stop-color="#ecf0f1"/>
      <stop offset=".58" stop-color="#ced6db"/><stop offset="1" stop-color="#7e8f99"/>
    </linearGradient>
    <radialGradient id="${prefix}-soccer" cx=".3" cy=".25" r=".8">
      <stop stop-color="#fff"/><stop offset=".65" stop-color="#f0f3f5"/><stop offset="1" stop-color="#c8d1d7"/>
    </radialGradient>
    <pattern id="${prefix}-grain" width="3" height="3" patternUnits="userSpaceOnUse">
      <path d="M0 1.5H3" stroke="#fff" stroke-width=".35" opacity=".18"/>
    </pattern>
    <filter id="${prefix}-shadow" x="-25%" y="-50%" width="150%" height="200%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
    <filter id="${prefix}-selection" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#008bd2" flood-opacity=".18"/>
    </filter>
  </defs>`;
}

function createDrawing(transform, prefix) {
  const { project } = transform;
  const points = (vertices) =>
    vertices
      .map((point) => {
        const projected = project(...point);
        return `${number(projected.x)},${number(projected.y)}`;
      })
      .join(" ");
  const polygon = (vertices, fill, extras = "") =>
    `<polygon points="${points(vertices)}" fill="${fill}" ${extras}/>`;
  const line = (from, to, extras = "") => {
    const a = project(...from);
    const b = project(...to);
    return `<line x1="${number(a.x)}" y1="${number(a.y)}" x2="${number(b.x)}" y2="${number(b.y)}" ${extras}/>`;
  };
  const paint = (name) => `url(#${prefix}-${name})`;
  return { project, points, polygon, line, paint };
}

/** Build a label in front-face millimetres, then project the entire label. */
function faceLabel(
  box,
  drawing,
  localX,
  elevation,
  width,
  height,
  className,
  text,
  fontSize,
  fill,
  textFill,
) {
  const origin = drawing.project(box.x + localX, box.y + 5, box.z + elevation);
  const right = drawing.project(
    box.x + localX + 1,
    box.y + 5,
    box.z + elevation,
  );
  const down = drawing.project(
    box.x + localX,
    box.y + 5,
    box.z + elevation - 1,
  );
  const matrix = [
    right.x - origin.x,
    right.y - origin.y,
    down.x - origin.x,
    down.y - origin.y,
    origin.x,
    origin.y,
  ].join(" ");
  return `<g class="${className}" transform="matrix(${matrix})" pointer-events="none">
    <rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="${Math.min(12, height * 0.12)}" fill="${fill}"/>
    <text text-anchor="middle" y="${fontSize * 0.34}" font-family="Inter,Arial,sans-serif" font-size="${fontSize}" font-weight="600" fill="${textFill}">${escape(text)}</text>
  </g>`;
}

// The clipping boundary and selection outline share one physical envelope.
// Selection is painted separately, after the scene, so adjacent/upper cases
// cannot erase an edge of the selected volume.
function boxEnvelope(box, view) {
  const { x, y, z, length, width, height } = box;
  const top = z + height;
  if (view === "top")
    return [
      [x, y, top],
      [x + length, y, top],
      [x + length, y + width, top],
      [x, y + width, top],
    ];
  if (view === "front")
    return [
      [x, y, z],
      [x + length, y, z],
      [x + length, y, top],
      [x, y, top],
    ];
  return [
    [x, y + width, top],
    [x + length, y + width, top],
    [x + length, y, top],
    [x + length, y, z],
    [x, y, z],
    [x, y + width, z],
  ];
}

function drawSelection(box, drawing, view, prefix) {
  if (!box) return "";
  const stroke = 'stroke="#008ed2" stroke-width="2" stroke-linejoin="round"';
  let faceEdges = "";
  if (view === "iso") {
    // The silhouette alone omits the front face's top and left edges. Add the
    // three seams where the visible front, side, and lid meet, without doubling
    // any strokes or drawing the hidden rear/bottom edges of a wireframe cube.
    const { x, y, z, length, width, height } = box;
    const corner = [x, y, z + height];
    faceEdges = [
      [x + length, y, z + height],
      [x, y + width, z + height],
      [x, y, z],
    ]
      .map((end) =>
        drawing.line(corner, end, `class="box-selection-edge" ${stroke}`),
      )
      .join("");
  }
  return `<g class="scene-selection" data-selected-box-id="${escape(box.id)}" pointer-events="none" aria-hidden="true">
    ${drawing.polygon(boxEnvelope(box, view), "none", `class="box-selection" ${stroke} filter="url(#${prefix}-selection)"`)}${faceEdges}
  </g>`;
}

function drawBox(box, drawing, options, scale, prefix) {
  const { x, y, z, length, width, height, model } = box;
  const { polygon, line, paint, project } = drawing;
  const top = z + height;
  const lidHeight = top - 12;
  const seam = top - Math.min(47, height * 0.2);
  const stroke = 'stroke="#929fa8" stroke-width=".8" stroke-linejoin="round"';
  const front = (left, right, bottom, upper, depth = y) => [
    [left, depth, bottom],
    [right, depth, bottom],
    [right, depth, upper],
    [left, depth, upper],
  ];
  const side = (near, far, bottom, upper, horizontal = x) => [
    [horizontal, near, bottom],
    [horizontal, far, bottom],
    [horizontal, far, upper],
    [horizontal, near, upper],
  ];
  const lid = (inset = 0, level = lidHeight) => [
    [x + inset, y + inset, level],
    [x + length - inset, y + inset, level],
    [x + length - inset, y + width - inset, level],
    [x + inset, y + width - inset, level],
  ];
  const envelope = boxEnvelope(box, options.view);
  const clipId = `${prefix}-envelope-${String(box.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  let art = "";
  let capacity = "";

  // Published outside dimensions include rails and corners. The panel is
  // recessed; the hardware stays inside the same envelope used for stacking.
  if (options.view !== "top") {
    art += polygon(
      side(y + 5, y + width - 5, z + 10, lidHeight, x + 5),
      paint("side"),
      stroke,
    );
    art += polygon(
      front(x + 5, x + length - 5, z + 10, lidHeight, y + 5),
      paint("front"),
      `${stroke} class="box-front"`,
    );
    art += polygon(
      front(x + 6, x + length - 6, z + 14, seam - 6, y + 5),
      paint("grain"),
    );

    for (const [railZ, railHeight] of [
      [z, 12],
      [seam, 8],
      [top - 20, 8],
    ]) {
      art += polygon(
        side(y, y + width, railZ, railZ + railHeight),
        paint("rail"),
        stroke,
      );
      art += polygon(
        front(x, x + length, railZ, railZ + railHeight),
        paint("rail"),
        stroke,
      );
      art += line(
        [x, y, railZ + railHeight],
        [x + length, y, railZ + railHeight],
        'stroke="#fff" stroke-width="1" opacity=".8"',
      );
    }
    for (const cornerX of [x + 10, x + length - 10]) {
      art += line(
        [cornerX, y + 4, z + 18],
        [cornerX, y + 4, seam - 5],
        'stroke="#adb8bf" stroke-width="1.1"',
      );
      art += line(
        [cornerX + 3, y + 4, z + 18],
        [cornerX + 3, y + 4, seam - 5],
        'stroke="#f5f7f8" stroke-width=".65" opacity=".8"',
      );
    }
    if (options.view !== "front") {
      const handleZ = top - Math.min(101, height * 0.52);
      art += polygon(
        side(
          y + width * 0.38,
          y + width * 0.62,
          handleZ - 15,
          handleZ + 24,
          x + 2,
        ),
        paint("hardware"),
        'stroke="#8999a3" stroke-width=".7"',
      );
      art += polygon(
        side(
          y + width * 0.4,
          y + width * 0.6,
          handleZ - 6,
          handleZ + 13,
          x + 1,
        ),
        "#a4b0b7",
        'stroke="#eef2f4" stroke-width="1"',
      );
      art += line(
        [x, y + width * 0.42, handleZ + 3],
        [x, y + width * 0.58, handleZ + 3],
        'stroke="#dce2e6" stroke-width="2.2"',
      );
    }
    for (const ratio of [0.23, 0.77]) {
      const latchX = x + length * ratio;
      const latchZ = seam - 15;
      art += polygon(
        front(latchX - 12, latchX + 12, latchZ - 25, latchZ + 24, y + 2),
        "#9ba9b2",
        'stroke="#798994" stroke-width=".7"',
      );
      art += polygon(
        front(latchX - 8, latchX + 8, latchZ - 21, latchZ + 21, y + 1),
        paint("hardware"),
        'stroke="#eaf0f3" stroke-width=".8"',
      );
      art += line(
        [latchX - 6, y, latchZ + 12],
        [latchX + 6, y, latchZ + 12],
        'stroke="#7f909b" stroke-width=".8"',
      );
      art += line(
        [latchX - 5, y, latchZ - 16],
        [latchX + 5, y, latchZ - 16],
        'stroke="#6f828f" stroke-width="1"',
      );
    }

    // Labels share the panel's affine projection. Their bounds are calculated
    // in millimetres, so a wide/rotated/shallow case cannot spill into a neighbour.
    const label = model.label || `${model.volume} L`;
    const panelLow = 24;
    const panelHigh = seam - z - 14;
    const panelHeight = panelHigh - panelLow;
    const targetFont = Math.max(13, Math.min(22, length * scale * 0.07));
    const font = Math.min(
      targetFont / scale,
      panelHeight / 1.7,
      (length - 52) / (label.length * 0.6 + 1.5),
    );
    const labelWidth = font * (label.length * 0.6 + 1.5);
    const labelHeight = font * 1.52;
    const badgeWidth = Math.min(95, length * 0.19);
    const badgeHeight = 24;
    // Extra clearance also separates their axis-aligned screen bounds after
    // the face's shear; this matters in close-up inspection and hit testing.
    const gap = Math.max(
      12,
      (options.view === "iso" ? (0.055 * (labelWidth + badgeWidth)) / 2 : 0) +
        3 / scale,
    );
    const showBadge =
      options.labels === false ||
      panelHeight >= labelHeight + badgeHeight + gap + 16;
    const combinedHeight = labelHeight + (showBadge ? badgeHeight + gap : 0);
    const capacityZ =
      panelLow + (panelHeight - combinedHeight) / 2 + labelHeight / 2;
    if (showBadge) {
      const badgeZ =
        options.labels === false
          ? Math.min(panelHigh - badgeHeight / 2, height * 0.61)
          : capacityZ + labelHeight / 2 + gap + badgeHeight / 2;
      art += faceLabel(
        box,
        drawing,
        length / 2,
        badgeZ,
        badgeWidth,
        badgeHeight,
        "box-badge",
        "ZARGES",
        badgeWidth * 0.15,
        "#174374",
        "#fff",
      );
    }
    if (options.labels !== false) {
      capacity = faceLabel(
        box,
        drawing,
        length / 2,
        capacityZ,
        labelWidth,
        labelHeight,
        "box-capacity",
        label,
        font,
        "#142936",
        "#fff",
      );
    }
  }

  // The lid is recessed below the stacking corners. The highest point of a
  // casting is exactly z+height, and the lowest rail begins exactly at z.
  art += polygon(lid(), paint("lid"), stroke);
  art += polygon(lid(17), "none", 'stroke="#b5c0c7" stroke-width=".8"');
  art += line(
    [x + 19, y + 19, lidHeight],
    [x + length - 19, y + 19, lidHeight],
    'stroke="#fff" stroke-width="1" opacity=".8"',
  );
  for (const cornerX of [x + 4, x + length - 36]) {
    for (const cornerY of [y + 4, y + width - 36]) {
      art += polygon(
        [
          [cornerX, cornerY, lidHeight],
          [cornerX + 32, cornerY, lidHeight],
          [cornerX + 32, cornerY, top],
          [cornerX, cornerY, top],
        ],
        "#90a6b4",
        'stroke="#748e9f" stroke-width=".45"',
      );
      art += polygon(
        [
          [cornerX, cornerY, lidHeight],
          [cornerX, cornerY + 32, lidHeight],
          [cornerX, cornerY + 32, top],
          [cornerX, cornerY, top],
        ],
        "#a5b7c2",
        'stroke="#8299a8" stroke-width=".45"',
      );
      art += polygon(
        [
          [cornerX, cornerY, top],
          [cornerX + 32, cornerY, top],
          [cornerX + 32, cornerY + 32, top],
          [cornerX, cornerY + 32, top],
        ],
        "#c6d3db",
        'stroke="#eff4f7" stroke-width=".65"',
      );
    }
  }
  if (options.labels !== false && options.view === "top") {
    const label = model.label || `${model.volume} L`;
    const font = Math.min(
      22 / scale,
      Math.max(14 / scale, length * 0.085),
      (length * 0.82) / (label.length * 0.6 + 1.5),
      (width * 0.82) / 1.52,
    );
    const labelWidth = font * (label.length * 0.6 + 1.5);
    const labelHeight = font * 1.52;
    const center = project(x + length / 2, y + width / 2, top);
    capacity = `<g class="box-capacity" transform="translate(${center.x} ${center.y}) scale(${scale})" pointer-events="none">
      <rect x="${-labelWidth / 2}" y="${-labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="${font * 0.2}" fill="#142936"/>
      <text text-anchor="middle" y="${font * 0.34}" font-family="Inter,Arial,sans-serif" font-size="${font}" font-weight="600" fill="#fff">${escape(label)}</text>
    </g>`;
  }
  return `<g class="case-object${options.selectedId === box.id ? " is-selected" : ""}" data-box-id="${escape(box.id)}" role="button" tabindex="0" aria-label="${escape(`${model.volume} litre ${model.name || "case"}, ${length} by ${width} by ${height} millimetres`)}" style="cursor:grab">
    <title>${escape(`${model.name || model.id} · ${model.volume} L · ${length} × ${width} × ${height} mm`)}</title>
    <defs><clipPath id="${clipId}">${polygon(envelope, "#fff", 'class="box-envelope"')}</clipPath></defs>
    <g class="box-art" clip-path="url(#${clipId})">${art}</g>${capacity}
  </g>`;
}

function drawFloor(items, drawing, prefix, options) {
  const { view } = options;
  const bounded = options.workspace !== false;
  if (!items.length && !bounded) return "";
  const { polygon, line } = drawing;
  const minX = bounded
    ? WORKSPACE.x
    : Math.floor((Math.min(...items.map((item) => item.x)) - 200) / 200) * 200;
  const maxX = bounded
    ? WORKSPACE.x + WORKSPACE.length
    : Math.ceil(
        (Math.max(...items.map((item) => item.x + item.length)) + 200) / 200,
      ) * 200;
  const minY = bounded
    ? WORKSPACE.y
    : Math.floor((Math.min(...items.map((item) => item.y)) - 180) / 200) * 200;
  const maxY = bounded
    ? WORKSPACE.y + WORKSPACE.width
    : Math.ceil(
        (Math.max(...items.map((item) => item.y + item.width)) + 350) / 200,
      ) * 200;
  let art = '<g class="scene-floor" pointer-events="none">';
  if (bounded && view !== "front") {
    art += polygon(
      [
        [minX, minY, 0],
        [maxX, minY, 0],
        [maxX, maxY, 0],
        [minX, maxY, 0],
      ],
      "#eaf1f6",
      `class="workspace-boundary" data-workspace-length-mm="${WORKSPACE.length}" data-workspace-width-mm="${WORKSPACE.width}" fill-opacity=".38" stroke="#86a5bb" stroke-width="1" stroke-dasharray="6 5" stroke-opacity=".65"`,
    );
  }
  if (view !== "front") {
    // Keep the 200 mm grid anchored at world zero even when the stage starts
    // at a negative coordinate. Matching partial cells appear at both depth edges.
    for (let x = Math.ceil(minX / 200) * 200; x <= maxX; x += 200)
      art += line(
        [x, minY, 0],
        [x, maxY, 0],
        'stroke="#bdcbd3" stroke-width=".7" opacity=".24"',
      );
    for (let y = Math.ceil(minY / 200) * 200; y <= maxY; y += 200)
      art += line(
        [minX, y, 0],
        [maxX, y, 0],
        'stroke="#bdcbd3" stroke-width=".7" opacity=".24"',
      );
  } else {
    art += line(
      [minX, 0, 0],
      [maxX, 0, 0],
      'stroke="#c6d1d8" stroke-width="1"',
    );
  }
  for (const box of items.filter((item) => item.z < 1)) {
    art += polygon(
      [
        [box.x - 6, box.y - 12, 0],
        [box.x + box.length + 24, box.y - 12, 0],
        [box.x + box.length + 24, box.y + box.width + 24, 0],
        [box.x - 6, box.y + box.width + 24, 0],
      ],
      "#667988",
      `opacity=".20" filter="url(#${prefix}-shadow)"`,
    );
  }
  return `${art}</g>`;
}

function drawHumanScale(items, transform, view, units) {
  const position = humanPosition(items);
  const base = transform.project(position.x, position.y, 0);
  const scale = transform.scale;
  const height = HUMAN_HEIGHT_MM * scale;
  const headY = base.y - height;
  let illustration;
  if (view === "top") {
    illustration = `<g transform="translate(${number(base.x)} ${number(base.y)}) scale(${scale})" fill="#7b8d99" opacity=".42">
      <ellipse rx="260" ry="130"/>
      <ellipse rx="100" ry="110" fill="#536d7e"/>
    </g>`;
  } else {
    // A 1000-unit silhouette is scaled to precisely 1828.8 mm. Crown y=0 and
    // soles y=1000 give the height an auditable physical reference.
    illustration = `<ellipse cx="${number(base.x)}" cy="${number(base.y + 2)}" rx="${number(290 * scale)}" ry="${number(40 * scale)}" fill="#718491" opacity=".12"/>
      <g class="human-figure" transform="translate(${number(base.x)} ${number(headY)}) scale(${height / 1000})" fill="#798b98" fill-opacity=".38">
        <ellipse cx="0" cy="67" rx="60" ry="67"/>
        <path d="M-32 133 L-34 161 Q-90 160 -118 181 Q-143 205 -153 284 L-189 487 Q-196 511 -176 518 Q-158 524 -150 500 L-110 342 L-100 525 L-127 951 Q-132 990 -103 1000 L-58 1000 Q-40 993 -39 973 L-19 705 Q-16 686 0 684 Q16 686 19 705 L39 973 Q40 993 58 1000 L103 1000 Q132 990 127 951 L100 525 L110 342 L150 500 Q158 524 176 518 Q196 511 189 487 L153 284 Q143 205 118 181 Q90 160 34 161 L32 133Z"/>
      </g>
      <g stroke="#8ba0af" stroke-width=".85" opacity=".7">
        <line x1="${number(base.x + 450 * scale)}" y1="${number(headY)}" x2="${number(base.x + 450 * scale)}" y2="${number(base.y)}"/>
        <path d="M${number(base.x + 450 * scale - 4)} ${number(headY)}h8 M${number(base.x + 450 * scale - 4)} ${number(base.y)}h8"/>
      </g>
      <g transform="translate(${number(base.x + 450 * scale)} ${number(base.y - height / 2)}) rotate(-90)">
        <rect x="-43" y="-10" width="86" height="20" rx="4" fill="#f4f7f9"/>
        <text text-anchor="middle" y="4" font-family="Inter,Arial,sans-serif" font-size="10" fill="#718695">${units === "in" ? "72 in" : "1,828.8 mm"}</text>
      </g>`;
  }
  return `<g class="human-scale" data-person-height-mm="1828.8" pointer-events="none" aria-label="Six-foot person for scale, 1,828.8 millimetres tall">
    ${illustration}
    <text x="${number(base.x)}" y="${number(base.y + (view === "top" ? 150 * scale + 22 : 26))}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="11" font-weight="600" fill="#758997">6 ft / 1.83 m</text>
  </g>`;
}

/** Original vector soccer ball: a size-five, 220 mm diameter scale reference. */
function drawSoccerScale(items, transform, view, units, prefix) {
  const position = soccerPosition(items);
  const radius = SOCCER_DIAMETER_MM / 2;
  const center = transform.project(position.x, position.y, radius);
  const ground = transform.project(position.x, position.y, 0);
  const scale = transform.scale;
  const panels = Array.from(
    { length: 5 },
    (_, index) => `<g transform="rotate(${index * 72})">
    <path d="M-28 -94L-17 -120H17L28 -94L0 -76Z" fill="#243643"/>
    <path d="M0 -43V-76M-28 -94L-72 -72" fill="none" stroke="#738490" stroke-width="2"/>
  </g>`,
  ).join("");
  return `<g class="soccer-scale" data-soccer-diameter-mm="220" pointer-events="none" aria-label="Soccer ball, 220 millimetres in diameter">
    <ellipse cx="${ground.x}" cy="${ground.y + 2}" rx="${radius * scale}" ry="${32 * scale}" fill="#617887" opacity=".16"/>
    <g class="soccer-figure" transform="translate(${center.x} ${center.y}) scale(${scale})">
      <defs><clipPath id="${prefix}-soccer-clip"><circle r="110"/></clipPath></defs>
      <circle class="soccer-outline" r="110" fill="url(#${prefix}-soccer)" stroke="#708491" stroke-width="2"/>
      <g clip-path="url(#${prefix}-soccer-clip)">
        ${panels}<path d="M0 -43L40.9 -13.3L25.3 34.8H-25.3L-40.9 -13.3Z" fill="#243643"/>
      </g>
    </g>
    <text x="${center.x}" y="${center.y + radius * scale + 17}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="9" fill="#758997">${units === "in" ? "Ø 8.7 in" : "Ø 220 mm"}</text>
  </g>`;
}

function drawDimensions(items, drawing, selectedId, view, units = "mm") {
  if (!items.length) return "";
  const { project, line } = drawing;
  const selected = items.find((item) => item.id === selectedId);
  const x = selected ? selected.x : Math.min(...items.map((item) => item.x));
  const y = selected ? selected.y : Math.min(...items.map((item) => item.y));
  const z = selected ? selected.z : 0;
  const length = selected
    ? selected.length
    : Math.max(...items.map((item) => item.x + item.length)) - x;
  const height = selected
    ? selected.height
    : Math.max(...items.map((item) => item.z + item.height));
  const width = selected
    ? selected.width
    : Math.max(...items.map((item) => item.y + item.width)) - y;
  const dimension = (from, to, millimetres, vertical = false) => {
    const a = project(...from);
    const b = project(...to);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    // Vertical labels follow their dimension line so they fit in the narrow
    // left gutter. Clamp only annotation positions; the shared scene/drag
    // projection must stay identical whether dimensions are visible or not.
    const labelHalfWidth = vertical ? 10 : 36;
    const labelHalfHeight = vertical ? 36 : 10;
    const labelX = Math.max(
      labelHalfWidth + 8,
      Math.min(VIEWBOX_WIDTH - labelHalfWidth - 8, midX),
    );
    const labelY = Math.max(
      labelHalfHeight + 8,
      Math.min(
        VIEWBOX_HEIGHT - labelHalfHeight - 8,
        midY + (vertical ? 0 : 18),
      ),
    );
    const label =
      units === "in"
        ? `${(millimetres / 25.4).toFixed(1)} in`
        : `${Math.round(millimetres)} mm`;
    return `${line(from, to, 'stroke="#618092" stroke-width=".9"')}
      <path d="M${number(a.x - 3)} ${number(a.y - 4)}l6 8 M${number(b.x - 3)} ${number(b.y - 4)}l6 8" stroke="#618092" stroke-width="1" fill="none"/>
      <g transform="translate(${number(labelX)} ${number(labelY)})${vertical ? " rotate(-90)" : ""}">
        <rect x="-36" y="-10" width="72" height="20" rx="4" fill="#f4f7f9" fill-opacity=".96"/>
        <text text-anchor="middle" y="4" font-family="Inter,Arial,sans-serif" font-size="11" fill="#506c7d" font-weight="600">${label}</text>
      </g>`;
  };
  let art = '<g class="scene-dimensions" pointer-events="none">';
  art += dimension([x, y - 110, z], [x + length, y - 110, z], length);
  if (view !== "top")
    art += dimension([x - 110, y, z], [x - 110, y, z + height], height, true);
  if (view === "top")
    art += dimension([x - 110, y, z], [x - 110, y + width, z], width, true);
  return `${art}</g>`;
}

/** Render all instances into a responsive, accessible SVG illustration. */
export function renderScene(boxes, catalog, options = {}) {
  const settings = {
    view: "iso",
    labels: true,
    dimensions: false,
    units: "mm",
    humanScale: true,
    soccerScale: false,
    workspace: true,
    ...options,
  };
  const prefix = `zarges-${++renderNumber}`;
  const transform = getSceneTransform(boxes, catalog, settings.view, settings);
  const drawing = createDrawing(transform, prefix);
  const items = itemsWithModels(boxes, catalog);
  const artwork = orderForDrawing(items, settings.view)
    .map((box) => drawBox(box, drawing, settings, transform.scale, prefix))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="stack-scene" viewBox="0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}" width="100%" height="100%" aria-label="Interactive aluminum case stack planner" style="display:block;overflow:visible;touch-action:none" data-view="${escape(settings.view)}">
    ${definitions(prefix)}${drawFloor(items, drawing, prefix, settings)}
    <g class="scene-boxes">${artwork}</g>
    ${settings.humanScale ? drawHumanScale(items, transform, settings.view, settings.units) : ""}
    ${settings.soccerScale ? drawSoccerScale(items, transform, settings.view, settings.units, prefix) : ""}
    ${settings.dimensions ? drawDimensions(items, drawing, settings.selectedId, settings.view, settings.units) : ""}
    ${drawSelection(
      items.find((box) => box.id === settings.selectedId),
      drawing,
      settings.view,
      prefix,
    )}
  </svg>`;
}

/**
 * Draw a drag candidate using the transform captured when the drag began.
 * Append this group to the existing scene SVG: it never changes the camera or
 * captures pointer events. The floor projection makes depth/elevation visible.
 */
export function renderPlacementPreview(
  box,
  catalog,
  transform,
  { valid = true } = {},
) {
  const candidate = itemsWithModels([box], catalog)[0];
  if (!candidate) return "";
  const { x, y, z, length, width, height } = candidate;
  const { polygon, line } = createDrawing(transform, "");
  const color = valid ? "#008ed2" : "#d34545";
  const outline = `stroke="${color}" stroke-width="1.8" stroke-dasharray="6 4" stroke-linejoin="round"`;
  const footprint = (elevation) => [
    [x, y, elevation],
    [x + length, y, elevation],
    [x + length, y + width, elevation],
    [x, y + width, elevation],
  ];
  let artwork = "";
  if (z > 0) {
    artwork += polygon(
      footprint(0),
      color,
      `${outline} fill-opacity=".045" stroke-opacity=".55"`,
    );
    for (const [cornerX, cornerY] of [
      [x, y],
      [x + length, y],
      [x, y + width],
      [x + length, y + width],
    ]) {
      artwork += line(
        [cornerX, cornerY, 0],
        [cornerX, cornerY, z],
        `stroke="${color}" stroke-width="1" stroke-dasharray="3 5" opacity=".45"`,
      );
    }
  }
  artwork += polygon(footprint(z), "none", `${outline} stroke-opacity=".65"`);
  artwork += polygon(
    [
      [x, y, z],
      [x, y + width, z],
      [x, y + width, z + height],
      [x, y, z + height],
    ],
    color,
    `${outline} fill-opacity=".12"`,
  );
  artwork += polygon(
    [
      [x, y, z],
      [x + length, y, z],
      [x + length, y, z + height],
      [x, y, z + height],
    ],
    color,
    `${outline} fill-opacity=".16"`,
  );
  artwork += polygon(
    footprint(z + height),
    color,
    `${outline} fill-opacity=".20"`,
  );
  return `<g class="placement-preview" data-valid="${valid ? "true" : "false"}" pointer-events="none" aria-hidden="true">${artwork}</g>`;
}

/** Catalogue artwork shares the scene renderer, so products stay consistent. */
export function renderBoxThumbnail(model) {
  return renderScene(
    [{ id: `preview-${model.id}`, modelId: model.id, x: 0, y: 0, z: 0 }],
    [model],
    {
      view: "iso",
      labels: false,
      thumbnail: true,
      humanScale: false,
      soccerScale: false,
      workspace: false,
    },
  )
    .replace('class="stack-scene"', 'class="box-thumbnail" aria-hidden="true"')
    .replace(/ tabindex="0"/g, "")
    .replace(/ role="button"/g, "");
}
