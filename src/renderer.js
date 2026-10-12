/**
 * Small, dependency-free technical illustration renderer.
 *
 * All geometry uses millimetres. Keeping the projection here (rather than in
 * pointer handlers) means dragging and rendering always agree about position.
 * The artwork is intentionally an illustration, not a mechanical/CAD model.
 */

let renderNumber = 0;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 680;
const HUMAN_HEIGHT_MM = 1828.8;
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
    for (const x of [box.x - 8, box.x + box.length + 8]) {
      for (const y of [box.y - 8, box.y + box.width + 8]) {
        for (const z of [box.z, box.z + box.height + 12])
          points.push(raw(x, y, z));
      }
    }
  }
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

function drawBox(box, drawing, options, scale, prefix) {
  const { x, y, z, length: length, width: width, height: height, model } = box;
  const { polygon, line, paint, project } = drawing;
  const top = z + height;
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
  const lid = (inset = 0, level = top) => [
    [x + inset, y + inset, level],
    [x + length - inset, y + inset, level],
    [x + length - inset, y + width - inset, level],
    [x + inset, y + width - inset, level],
  ];
  let art = "";

  if (options.view !== "top") {
    art += polygon(side(y, y + width, z + 8, top), paint("side"), stroke);
    art += polygon(front(x, x + length, z + 8, top), paint("front"), stroke);
    art += polygon(
      front(x + 4, x + length - 4, z + 14, seam - 6),
      paint("grain"),
    );

    // Extruded perimeter rails: separate top, front and side surfaces give a
    // recognisable aluminum profile even at the small catalogue scale.
    for (const [railZ, railHeight] of [
      [z + 9, 12],
      [seam, 9],
      [top - 3, 9],
    ]) {
      art += polygon(
        front(x - 5, x + length + 5, railZ, railZ + railHeight, y - 5),
        paint("rail"),
        stroke,
      );
      art += polygon(
        side(y - 5, y + width + 5, railZ, railZ + railHeight, x - 5),
        paint("rail"),
        stroke,
      );
      art += line(
        [x - 5, y - 5, railZ + railHeight],
        [x + length + 5, y - 5, railZ + railHeight],
        'stroke="#fff" stroke-width="1" opacity=".8"',
      );
    }

    // Subtle panel breaks and the vertical reinforced corners.
    for (const cornerX of [x + 10, x + length - 10]) {
      art += line(
        [cornerX, y - 1, z + 25],
        [cornerX, y - 1, seam - 5],
        'stroke="#adb8bf" stroke-width="1.1"',
      );
      art += line(
        [cornerX + 3, y - 1, z + 25],
        [cornerX + 3, y - 1, seam - 5],
        'stroke="#f5f7f8" stroke-width=".65" opacity=".8"',
      );
    }

    if (options.view !== "front") {
      // Spring handle mounted on the short side, with an inset dark grip.
      const handleZ = top - Math.min(101, height * 0.52);
      art += polygon(
        side(
          y + width * 0.38,
          y + width * 0.62,
          handleZ - 15,
          handleZ + 24,
          x - 2,
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
          x - 3,
        ),
        "#a4b0b7",
        'stroke="#eef2f4" stroke-width="1"',
      );
      art += line(
        [x - 5, y + width * 0.42, handleZ + 3],
        [x - 5, y + width * 0.58, handleZ + 3],
        'stroke="#dce2e6" stroke-width="2.2"',
      );
    }

    // Two toggle catches are deliberately constructed in world coordinates so
    // their size remains the same on every case, regardless of capacity.
    for (const ratio of [0.23, 0.77]) {
      const latchX = x + length * ratio;
      const latchZ = seam - 15;
      art += polygon(
        front(latchX - 12, latchX + 12, latchZ - 25, latchZ + 24, y - 7),
        "#9ba9b2",
        'stroke="#798994" stroke-width=".7"',
      );
      art += polygon(
        front(latchX - 8, latchX + 8, latchZ - 21, latchZ + 21, y - 9),
        paint("hardware"),
        'stroke="#eaf0f3" stroke-width=".8"',
      );
      art += line(
        [latchX - 6, y - 10, latchZ + 12],
        [latchX + 6, y - 10, latchZ + 12],
        'stroke="#7f909b" stroke-width=".8"',
      );
      art += line(
        [latchX - 5, y - 10, latchZ - 16],
        [latchX + 5, y - 10, latchZ - 16],
        'stroke="#6f828f" stroke-width="1"',
      );
    }

    const badge = project(
      x + length * 0.5,
      y - 7,
      top - Math.min(91, height * 0.44),
    );
    const badgeWidth = Math.max(24, Math.min(48, length * scale * 0.13));
    art += `<g transform="translate(${number(badge.x)} ${number(badge.y)}) rotate(-3.2)">
      <rect x="${-badgeWidth / 2}" y="-5.5" width="${badgeWidth}" height="11" rx=".8" fill="#174374"/>
      <text text-anchor="middle" y="2.5" font-family="Arial,sans-serif" font-weight="800" font-size="${number(badgeWidth * 0.16)}" letter-spacing=".5" fill="#fff">ZARGES</text>
    </g>`;
  }

  // The lid is added after the body, but below the corner castings.
  art += polygon(lid(-5, top + 6), paint("lid"), stroke);
  art += polygon(
    lid(17, top + 7),
    "none",
    'stroke="#b5c0c7" stroke-width=".8"',
  );
  art += line(
    [x + 19, y + 19, top + 8],
    [x + length - 19, y + 19, top + 8],
    'stroke="#fff" stroke-width="1" opacity=".8"',
  );

  // Cast stacking corners. These are visual guides only; compatibility is
  // deliberately evaluated in the separate geometry/stacking module.
  for (const cornerX of [x + 4, x + length - 37]) {
    for (const cornerY of [y + 4, y + width - 37]) {
      const vertices = [
        [cornerX, cornerY, top + 17],
        [cornerX + 32, cornerY, top + 17],
        [cornerX + 32, cornerY + 32, top + 17],
        [cornerX, cornerY + 32, top + 17],
      ];
      art += polygon(
        [
          [cornerX, cornerY, top + 5],
          [cornerX + 32, cornerY, top + 5],
          [cornerX + 32, cornerY, top + 17],
          [cornerX, cornerY, top + 17],
        ],
        "#90a6b4",
        'stroke="#748e9f" stroke-width=".45"',
      );
      art += polygon(
        [
          [cornerX, cornerY, top + 5],
          [cornerX, cornerY + 32, top + 5],
          [cornerX, cornerY + 32, top + 17],
          [cornerX, cornerY, top + 17],
        ],
        "#a5b7c2",
        'stroke="#8299a8" stroke-width=".45"',
      );
      art += polygon(
        vertices,
        "#c6d3db",
        'stroke="#eff4f7" stroke-width=".65"',
      );
    }
  }

  if (options.selectedId === box.id) {
    const outline =
      options.view === "top"
        ? lid(-8, top + 19)
        : [
            [x - 8, y + width + 8, top + 12],
            [x + length + 8, y + width + 8, top + 12],
            [x + length + 8, y - 8, top + 12],
            [x + length + 8, y - 8, z + 2],
            [x - 8, y - 8, z + 2],
            [x - 8, y + width + 8, z + 2],
          ];
    art += polygon(
      outline,
      "none",
      `stroke="#008ed2" stroke-width="2" stroke-linejoin="round" filter="url(#${prefix}-selection)"`,
    );
  }

  if (options.labels !== false) {
    const location =
      options.view === "top"
        ? project(x + length / 2, y + width / 2, top)
        : project(
            x + length / 2,
            y - 8,
            z + Math.min(height * 0.35, height - 120),
          );
    const label = `${model.volume} L${/long/i.test(`${model.label || ""} ${model.name || ""} ${model.id}`) ? " long" : ""}`;
    const fontSize = options.thumbnail
      ? 18
      : Math.max(14, Math.min(22, length * scale * 0.085));
    const labelWidth = label.length * fontSize * 0.56 + 22;
    art += `<g class="box-capacity" transform="translate(${number(location.x)} ${number(location.y)})" pointer-events="none">
      <rect x="${number(-labelWidth / 2)}" y="${number(-fontSize * 0.77)}" width="${number(labelWidth)}" height="${number(fontSize * 1.52)}" rx="4" fill="#142936" fill-opacity=".91"/>
      <text y="${number(fontSize * 0.34)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${number(fontSize)}" font-weight="550" letter-spacing="-.5" fill="#fff">${escape(label)}</text>
    </g>`;
  }

  return `<g class="case-object${options.selectedId === box.id ? " is-selected" : ""}" data-box-id="${escape(box.id)}" role="button" tabindex="0" aria-label="${escape(`${model.volume} litre ${model.name || "case"}, ${length} by ${width} by ${height} millimetres`)}" style="cursor:grab">
    <title>${escape(`${model.name || model.id} · ${model.volume} L · ${length} × ${width} × ${height} mm`)}</title>${art}</g>`;
}

function drawFloor(items, drawing, prefix, view) {
  if (!items.length) return "";
  const { polygon, line } = drawing;
  const minX =
    Math.floor((Math.min(...items.map((item) => item.x)) - 200) / 200) * 200;
  const maxX =
    Math.ceil(
      (Math.max(...items.map((item) => item.x + item.length)) + 200) / 200,
    ) * 200;
  const minY =
    Math.floor((Math.min(...items.map((item) => item.y)) - 180) / 200) * 200;
  const maxY =
    Math.ceil(
      (Math.max(...items.map((item) => item.y + item.width)) + 350) / 200,
    ) * 200;
  let art = '<g class="scene-floor" pointer-events="none">';
  if (view !== "front") {
    for (let x = minX; x <= maxX; x += 200)
      art += line(
        [x, minY, 0],
        [x, maxY, 0],
        'stroke="#bdcbd3" stroke-width=".7" opacity=".24"',
      );
    for (let y = minY; y <= maxY; y += 200)
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
    ${definitions(prefix)}${drawFloor(items, drawing, prefix, settings.view)}
    <g class="scene-boxes">${artwork}</g>
    ${settings.humanScale ? drawHumanScale(items, transform, settings.view, settings.units) : ""}
    ${settings.dimensions ? drawDimensions(items, drawing, settings.selectedId, settings.view, settings.units) : ""}
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
    },
  )
    .replace('class="stack-scene"', 'class="box-thumbnail" aria-hidden="true"')
    .replace(/ tabindex="0"/g, "")
    .replace(/ role="button"/g, "");
}
