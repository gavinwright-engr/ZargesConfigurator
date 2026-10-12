import { CATALOG, PRESET } from "./catalog.js";
import { encodeCaseClipboard, parseCaseClipboard } from "./clipboard.js";
import { getDimensions, inspectLayout, resolveDrop } from "./stacking.js";
import {
  validateWorkspace,
  findFloorPlacement,
  repairWorkspace,
} from "./workspace.js";
import {
  renderScene,
  renderBoxThumbnail,
  getSceneTransform,
  renderPlacementPreview,
} from "./renderer.js";
import {
  STORAGE_KEY,
  MAX_CASES,
  makePlan,
  parsePlan,
  encodePlan,
  decodePlan,
  boxListCsv,
} from "./plans.js";

const $ = (selector) => document.querySelector(selector);
const modelFor = (box) => CATALOG.find((model) => model.id === box.modelId);
const copy = (value) => structuredClone(value);
let boxes = copy(PRESET),
  selectedId = null,
  view = "iso",
  units = "mm",
  dimensions = false,
  humanScale = true,
  soccerScale = false,
  catalogFilter = "all";
let history = [],
  future = [],
  drag = null,
  toastTimer,
  startupMessage = "",
  preserveSavedPlan = false;

// Shared links take precedence over local sessions; all external data is validated.
try {
  if (location.hash.startsWith("#plan="))
    boxes = decodePlan(location.hash.slice(6));
  else {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) boxes = parsePlan(saved);
  }
  // Older versions allowed unbounded positions. Bring those cases nearby
  // without deleting any, and retain the original plan as a recovery copy.
  if (!validateWorkspace(boxes, CATALOG).valid) {
    const repaired = repairWorkspace(boxes, CATALOG);
    // If storage is full, leave the original session untouched. A failed
    // backup must not accidentally render the old, unbounded arrangement.
    try {
      localStorage.setItem(
        `${STORAGE_KEY}:before-workspace-limits`,
        JSON.stringify(makePlan(boxes)),
      );
    } catch {
      preserveSavedPlan = true;
    }
    if (repaired) {
      boxes = repaired;
      startupMessage = preserveSavedPlan
        ? "Distant cases moved into the work area. Storage is unavailable; use Save plan to keep this arrangement."
        : "Distant cases moved into the work area. All cases kept; original plan backed up on this device.";
    } else {
      preserveSavedPlan = true;
      boxes = copy(PRESET);
      startupMessage =
        "Your saved plan exceeds the work area. It is still saved on this device; showing the reference setup.";
    }
  }
} catch (error) {
  boxes = copy(PRESET);
  preserveSavedPlan = true;
  startupMessage = `Could not restore plan: ${error.message} Loaded the reference setup.`;
}

function notify(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 4400);
}

let copiedCaseText = "";

// Browser copy/paste events keep OS keyboard shortcuts working without asking
// for clipboard permission. The buttons also work when clipboard access is denied.
function clipboardShortcutAllowed(event) {
  const target = event.target;
  return (
    !$("#dialog").open &&
    !(
      target instanceof Element &&
      target.closest(
        "input,textarea,select,[contenteditable]:not([contenteditable='false'])",
      )
    ) &&
    !window.getSelection()?.toString()
  );
}
function selectedCaseClipboardText() {
  const selected = boxes.find((box) => box.id === selectedId);
  if (!selected) {
    notify("Select a case to copy first.");
    return null;
  }
  copiedCaseText = encodeCaseClipboard(selected);
  return copiedCaseText;
}
function pasteCaseText(text) {
  const descriptor = parseCaseClipboard(text, CATALOG);
  if (!descriptor) {
    notify("Copy a ZARGES case first, then paste it into the workspace.");
    return false;
  }
  // addCase chooses a nearby, valid floor position and assigns a fresh ID.
  return addCase(descriptor.modelId, null, { rotated: descriptor.rotated });
}
async function copySelectedCase() {
  const text = selectedCaseClipboardText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notify("Case copied. Use Ctrl/Cmd+V or Paste to add a copy.");
  } catch {
    notify("Case copied in this tab. Use the Paste button to add a copy.");
  }
}
async function pasteCopiedCase() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = copiedCaseText;
  }
  // Successfully reading unrelated text must not paste an older internal copy.
  pasteCaseText(text);
}
document.addEventListener("copy", (event) => {
  if (!clipboardShortcutAllowed(event) || !selectedId || !event.clipboardData)
    return;
  const text = selectedCaseClipboardText();
  if (!text) return;
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
  notify("Case copied. Use Ctrl/Cmd+V or Paste to add a copy.");
});
document.addEventListener("paste", (event) => {
  if (!clipboardShortcutAllowed(event) || !event.clipboardData) return;
  event.preventDefault();
  pasteCaseText(event.clipboardData.getData("text/plain"));
});
function persist() {
  if (preserveSavedPlan) {
    $("#saved-state").textContent = "Original plan retained on this device";
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makePlan(boxes)));
    $("#saved-state").textContent = "Saved on this device";
  } catch {
    $("#saved-state").textContent = "Use Save plan to keep changes";
  }
}
function commit(next, message) {
  if (!inspectLayout(next, CATALOG).valid) {
    notify(
      "That would leave a case unsupported or overlapping. Move the upper cases first.",
    );
    return false;
  }
  const workspace = validateWorkspace(next, CATALOG);
  if (!workspace.valid) {
    notify(workspace.issues[0].message);
    return false;
  }
  try {
    next = parsePlan({ version: 1, units: "mm", boxes: next });
  } catch (error) {
    notify(error.message);
    return false;
  }
  history.push(copy(boxes));
  if (history.length > 60) history.shift();
  future = [];
  boxes = next;
  preserveSavedPlan = false;
  if (!boxes.some((box) => box.id === selectedId)) selectedId = null;
  persist();
  render();
  if (message) notify(message);
  return true;
}
function length(value) {
  return units === "mm"
    ? Math.round(value).toLocaleString("en-US")
    : (value / 25.4).toFixed(2);
}
function dimensionText(values) {
  return `${values.map(length).join(" × ")} ${units}`;
}

function renderCatalog() {
  const query = $("#search").value.trim().toLowerCase();
  const referenceIds = new Set(
    CATALOG.filter((model) => model.reference).map((model) => model.id),
  );
  const visible = CATALOG.filter(
    (model) =>
      (catalogFilter === "all" || model.reference) &&
      `${model.label} ${model.id} ${model.external.join(" ")} K 470`
        .toLowerCase()
        .includes(query),
  ).sort((a, b) => a.volume - b.volume || a.external[0] - b.external[0]);
  $("#catalog-count").textContent = CATALOG.length;
  $("[data-catalog='all']").textContent = `All ${CATALOG.length} sizes`;
  $("[data-catalog='reference']").textContent =
    `Reference ${referenceIds.size}`;
  $("#catalog-list").innerHTML =
    visible
      .map(
        (model) =>
          `<article class="case-card" draggable="true" data-model="${model.id}" aria-label="${model.label}, model ${model.id}"><div class="case-thumbnail">${renderBoxThumbnail(model)}</div><div class="case-info"><strong>${model.label}<span class="model-id">${model.id}</span></strong><p>${dimensionText(model.external)}</p><span class="family">K 470 · ${model.weight.toFixed(1)} kg</span></div><button class="add-case" data-add="${model.id}" aria-label="Add ${model.label} case">+</button></article>`,
      )
      .join("") ||
    '<p class="no-results">No matching cases. Try “73” or “40847”.</p>';
}
function renderSelection() {
  const selected = boxes.find((box) => box.id === selectedId);
  if (!selected) {
    $("#selection").innerHTML =
      '<div class="selection-title"><strong>✓ A place for every case</strong></div><p>Choose a case in the workspace to see its size, rotate it, or adjust its position.</p>';
    return;
  }
  const model = modelFor(selected);
  $("#selection").innerHTML =
    `<div class="selection-title"><strong>${model.label} · K 470</strong><button class="icon-button" data-action="deselect" aria-label="Deselect case">×</button></div><span class="selection-model">MODEL ${model.id}</span><p>${dimensionText(getDimensions(selected, CATALOG))}<br>Base elevation ${length(selected.z)} ${units} · ${selected.rotated ? "90° orientation" : "0° orientation"}</p><div class="selection-actions"><button data-action="rotate">↻ Rotate</button><button data-action="copy" title="Copy selected case (Ctrl/Cmd+C)">Copy</button><button data-action="remove" aria-label="Remove selected case">Remove</button></div><div class="position-controls" aria-label="Move selected case by 10 millimeters"><button data-nudge="-10,0" aria-label="Move left 10 mm">←</button><button data-nudge="0,-10" aria-label="Move back 10 mm">↑</button><button data-nudge="0,10" aria-label="Move forward 10 mm">↓</button><button data-nudge="10,0" aria-label="Move right 10 mm">→</button><span>10 mm steps</span></div><div class="surface-controls"><select id="surface-target" aria-label="Surface to place selected case on"><option value="floor">Clear floor space</option>${boxes
      .filter((box) => box.id !== selectedId)
      .map(
        (box, i) =>
          `<option value="${box.id}">${modelFor(box).label} · case ${boxes.indexOf(box) + 1}</option>`,
      )
      .join(
        "",
      )}</select><button data-action="place-on">Place on</button></div>`;
}
function drawScene(items = boxes) {
  $("#scene").innerHTML = renderScene(items, CATALOG, {
    view,
    dimensions,
    selectedId,
    units,
    humanScale,
    soccerScale,
  });
  $("#scene")
    .querySelectorAll("[data-box-id]")
    .forEach((node) => {
      const box = items.find((item) => item.id === node.dataset.boxId);
      if (!box) return;
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.setAttribute(
        "aria-label",
        `Select ${modelFor(box).label}, model ${box.modelId}`,
      );
      node.setAttribute("aria-pressed", String(box.id === selectedId));
    });
}
function render() {
  drawScene();
  renderSelection();
  const { stats } = inspectLayout(boxes, CATALOG);
  $("#total-boxes").textContent = boxes.length;
  $("#total-volume").innerHTML = `${stats.volumeLiters}<small> L</small>`;
  $("#total-weight").textContent = `${stats.emptyWeightKg.toFixed(1)} kg`;
  $("#total-height").textContent = `${length(stats.height)} ${units}`;
  $("#fit-indicator").textContent = boxes.length
    ? "All cases geometrically supported"
    : "Ready for your first case";
  $("#empty-state").hidden = boxes.length > 0;
  $("#configuration-label").textContent =
    JSON.stringify(boxes) === JSON.stringify(PRESET)
      ? "Two stacks. One organized setup."
      : `${boxes.length} ${boxes.length === 1 ? "case" : "cases"}. Your own possibilities.`;
  const rows = CATALOG.filter((model) =>
    boxes.some((box) => box.modelId === model.id),
  );
  $("#box-list").innerHTML =
    rows
      .map(
        (model) =>
          `<div class="box-row"><span>${model.label}<small>${model.id}</small></span><span class="qty">× ${boxes.filter((box) => box.modelId === model.id).length}</span></div>`,
      )
      .join("") || '<p class="no-results">Your box list will appear here.</p>';
  $("#list-count").textContent = `${rows.length} models`;
  $("#undo").disabled = !history.length;
  $("#redo").disabled = !future.length;
}
// The engine returns validation metadata; persisted instances contain only position.
function cleanBox(box) {
  const { id, modelId, x, y, z, rotated } = box;
  return { id, modelId, x, y, z, rotated: !!rotated };
}
function addCase(modelId, candidate = null, options = {}) {
  if (boxes.length >= MAX_CASES) {
    notify("This planner supports up to 60 cases per setup.");
    return false;
  }
  const box =
    candidate ||
    findFloorPlacement(modelId, boxes, CATALOG, {
      id: `case-${crypto.randomUUID()}`,
      rotated: !!options.rotated,
    });
  if (!box) {
    notify(
      "No nearby floor space is available. Stack or remove a case to make room.",
    );
    return false;
  }
  const previousSelection = selectedId;
  selectedId = box.id;
  const added = commit(
    [...boxes, cleanBox(box)],
    `${CATALOG.find((model) => model.id === modelId).label} added to your setup.`,
  );
  if (!added) selectedId = previousSelection;
  return added;
}
function mutateSelected(transform) {
  const selected = boxes.find((box) => box.id === selectedId);
  if (selected)
    commit(
      boxes.map((box) =>
        box.id === selectedId ? transform(copy(selected)) : box,
      ),
    );
}
// Explicit placement gives keyboard and touch users the same stacking operation
// as dragging. Try surface corners and both orientations, validating all cases.
function placeOnSurface() {
  const selected = boxes.find((box) => box.id === selectedId);
  if (!selected) return;
  const target = boxes.find((box) => box.id === $("#surface-target").value);
  const others = boxes.filter((box) => box.id !== selectedId);
  if (!target) {
    const placed = findFloorPlacement(
      selected.modelId,
      others,
      CATALOG,
      selected,
    );
    if (placed) commit([...others, placed], "Case placed on the floor.");
    else
      notify(
        "No nearby floor space is available, or upper cases still need this support.",
      );
    return;
  }
  const [tw, td, th] = getDimensions(target, CATALOG);
  for (const rotated of [selected.rotated, !selected.rotated]) {
    const [w, d] = getDimensions({ ...selected, rotated }, CATALOG);
    for (const x of [target.x, target.x + tw - w])
      for (const y of [target.y, target.y + td - d]) {
        const next = { ...selected, x, y, z: target.z + th, rotated };
        if (inspectLayout([...others, next], CATALOG).valid) {
          commit(
            boxes.map((box) => (box.id === selectedId ? next : box)),
            "Case placed on the selected surface.",
          );
          return;
        }
      }
  }
  notify(
    "No supported space on this surface. Try another case or move upper cases first.",
  );
}
function undo() {
  if (!history.length) return;
  future.push(copy(boxes));
  boxes = history.pop();
  selectedId = null;
  persist();
  render();
}
function redo() {
  if (!future.length) return;
  history.push(copy(boxes));
  boxes = future.pop();
  selectedId = null;
  persist();
  render();
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openDialog(html) {
  $("#dialog-content").innerHTML = html;
  $("#dialog-content h2").id = "dialog-title";
  $("#dialog").setAttribute("aria-labelledby", "dialog-title");
  $("#dialog").showModal();
}
const fitDetails = () =>
  openDialog(
    `<span class="eyebrow">DIMENSIONS, WITH CONTEXT</span><h2>What “fits” really means.</h2><p>This planner uses the <strong>maximum outer dimensions</strong> published by ZARGES Europe, in millimeters. Inches are converted from the same data, so switching units never changes the geometry.</p><h3>Shared footprint · 29 / 42 / 60 / 73 L</h3><p>These four cases have a 600 × 400 mm outer footprint. ZARGES USA explicitly lists them as stacking with one another.</p><h3>Mixed sizes · your reference setup</h3><p>The 1,200 × 400 mm long case geometrically spans two 600 × 400 mm cases. The 800 × 600 mm base geometrically supports two rotated 400 × 600 mm cases. These combinations have full rectangular support in the model; manufacturer confirmation of corner engagement is still needed.</p><h3>What the model does not simulate</h3><p>Lid and foot profiles, corner engagement, stacking height reductions, payloads, center of gravity, tipping, tie-downs, and dynamic loads. Heights sum the published outer dimensions; actual nested height may differ.</p><p><a href="https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40678" target="_blank" rel="noreferrer">ZARGES Europe dimensional source <svg class="arrow-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg></a><br><a href="https://zargesusa.com/products/k470-40810" target="_blank" rel="noreferrer">ZARGES USA same-footprint stacking information <svg class="arrow-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg></a></p>`,
  );
const actions = {
  undo,
  redo,
  reset: () => {
    selectedId = null;
    commit(copy(PRESET), "Reference setup restored.");
  },
  clear: () => commit([], "Workspace cleared. Use Undo to bring it back."),
  deselect: () => {
    selectedId = null;
    render();
  },
  fit: () => {
    drawScene();
    notify("View fitted to all cases.");
  },
  rotate: () => mutateSelected((box) => ({ ...box, rotated: !box.rotated })),
  "place-on": placeOnSurface,
  copy: copySelectedCase,
  paste: pasteCopiedCase,
  remove: () => {
    if (selectedId)
      commit(
        boxes.filter((box) => box.id !== selectedId),
        "Case removed.",
      );
  },
  export: () => {
    download("zarges-box-list.csv", boxListCsv(boxes), "text/csv");
    notify("Box list exported.");
  },
  save: () =>
    download(
      "zarges-stack-plan.json",
      JSON.stringify(makePlan(boxes), null, 2),
      "application/json",
    ),
  import: () => $("#import-file").click(),
  "fit-details": fitDetails,
  share: async () => {
    const url = new URL(location.href);
    url.hash = `plan=${encodePlan(boxes)}`;
    try {
      await navigator.clipboard.writeText(url.href);
      notify("Setup link copied. Open this link to restore the same layout.");
    } catch {
      openDialog(
        '<span class="eyebrow">TAKE YOUR SETUP WITH YOU</span><h2>Share your configuration.</h2><p>Copy this link to open the same arrangement on another device.</p><input class="share-input" readonly aria-label="Setup share link">',
      );
      $(".share-input").value = url.href;
      $(".share-input").select();
    }
  },
  guide: () =>
    openDialog(
      '<span class="eyebrow">A FEW SIMPLE MOVES</span><h2>Make the space yours.</h2><ol><li><strong>Choose a case.</strong> Drag it from the collection or press + to place it on the floor.</li><li><strong>Build your stack.</strong> Drag a case onto another. The planner snaps edges and finds a supported level. Use Top view for precise footprint placement.</li><li><strong>Fine-tune.</strong> Click a case to rotate, copy, remove, or move it in 10 mm steps. Move top cases before their supports.</li><li><strong>Compare.</strong> Switch between 3D, Front, and Top views; show dimensions or switch units.</li><li><strong>Take it with you.</strong> Export your box list, save a JSON plan, or copy a share link.</li></ol><p>Keyboard: Tab then Enter to select a case; R to rotate; Delete to remove; arrow keys to move 10 mm; Ctrl/Cmd+C to copy; Ctrl/Cmd+V to paste a new case nearby; Ctrl/Cmd+Z to undo. Copies keep the original model and rotation. Buttons provide the same actions on touch screens.</p>',
    ),
  "catalog-dialog": () =>
    openDialog(
      `<span class="eyebrow">THE K 470 COLLECTION</span><h2>${CATALOG.length} sizes. More possibilities.</h2><p>The complete standard K 470 Universal Box range. Dimensions below are maximum outer envelopes, not internal packing space. Special IP65/IP67 variants and other ZARGES series are separate product ranges.</p><table><thead><tr><th>CAPACITY</th><th>MODEL</th><th>EXTERIOR / mm</th><th>INTERIOR / mm</th></tr></thead><tbody>${[
        ...CATALOG,
      ]
        .sort((a, b) => a.volume - b.volume)
        .map(
          (model) =>
            `<tr><td>${model.label}</td><td><a href="${model.url}" target="_blank" rel="noreferrer">${model.id} <svg class="arrow-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg></a></td><td>${model.external.join(" × ")}</td><td>${model.internal.join(" × ")}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table><p>Different regional catalogs can report different measurement envelopes. This planner consistently uses the European published values.</p>`,
    ),
};
document.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  if (add) return addCase(add.dataset.add);
  const action = event.target.closest("[data-action]");
  if (action) actions[action.dataset.action]?.();
  const filter = event.target.closest("button[data-catalog]");
  if (filter) {
    catalogFilter = filter.dataset.catalog;
    document.querySelectorAll("button[data-catalog]").forEach((button) => {
      button.classList.toggle("active", button === filter);
      button.setAttribute("aria-pressed", String(button === filter));
    });
    renderCatalog();
  }
  const unit = event.target.closest("[data-unit]");
  if (unit) {
    units = unit.dataset.unit;
    document.querySelectorAll("[data-unit]").forEach((button) => {
      button.classList.toggle("active", button === unit);
      button.setAttribute("aria-pressed", String(button === unit));
    });
    renderCatalog();
    render();
  }
  const camera = event.target.closest("button[data-view]");
  if (camera) {
    view = camera.dataset.view;
    document.querySelectorAll("button[data-view]").forEach((button) => {
      button.classList.toggle("active", button === camera);
      button.setAttribute("aria-pressed", String(button === camera));
    });
    render();
  }
  const nudge = event.target.closest("[data-nudge]");
  if (nudge) {
    const [x, y] = nudge.dataset.nudge.split(",").map(Number);
    mutateSelected((box) => ({ ...box, x: box.x + x, y: box.y + y }));
  }
});
$("#search").addEventListener("input", renderCatalog);
$("#dimensions").addEventListener("change", (event) => {
  dimensions = event.target.checked;
  render();
});
$("#human-scale").addEventListener("change", (event) => {
  humanScale = event.target.checked;
  drawScene();
});
$("#soccer-scale").addEventListener("change", (event) => {
  soccerScale = event.target.checked;
  drawScene();
});
$(".dialog-close").addEventListener("click", () => $("#dialog").close());
$("#dialog").addEventListener("click", (event) => {
  if (event.target === $("#dialog")) {
    const r = $("#dialog").getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      $("#dialog").close();
  }
});
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 100000)
      throw new Error("Plan files must be smaller than 100 KB.");
    commit(parsePlan(await file.text()), "Saved plan opened.");
  } catch (error) {
    notify(`Could not open plan: ${error.message}`);
  }
  event.target.value = "";
});

// Pointer drags invert the renderer's projection. The transform stays fixed while
// dragging, so auto-fit never changes the relationship between pointer and case.
function svgPoint(event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(
    $("#scene svg").getScreenCTM().inverse(),
  );
}
$("#scene").addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const node = event.target.closest("[data-box-id]");
  if (!node) {
    selectedId = null;
    render();
    return;
  }
  const box = boxes.find((item) => item.id === node.dataset.boxId);
  selectedId = box.id;
  const transform = getSceneTransform(boxes, CATALOG, view, {
      humanScale,
      soccerScale,
    }),
    point = svgPoint(event),
    world = transform.unproject(point.x, point.y, box.z);
  drag = {
    box: copy(box),
    transform,
    start: { x: event.clientX, y: event.clientY },
    offset: { x: world.x - box.x, y: world.y - box.y },
    moved: false,
    candidate: null,
  };
  $("#scene").setPointerCapture(event.pointerId);
  renderSelection();
  drawScene();
});
$("#scene").addEventListener("pointermove", (event) => {
  if (
    !drag ||
    (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) <
      5 &&
      !drag.moved)
  )
    return;
  drag.moved = true;
  $("#scene").classList.add("dragging");
  const point = svgPoint(event),
    others = boxes.filter((box) => box.id !== drag.box.id);
  const hit = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest("[data-box-id]");
  const support = hit && others.find((box) => box.id === hit.dataset.boxId);
  // Changing surfaces also changes the inverse projection plane. Top view is
  // independent of elevation; other views use the surface under the pointer.
  const elevation = support
    ? support.z + getDimensions(support, CATALOG)[2]
    : hit?.dataset.boxId === drag.box.id
      ? drag.box.z
      : 0;
  const world = drag.transform.unproject(
    point.x,
    point.y,
    view === "top" ? 0 : elevation,
  );
  let candidate = resolveDrop(
    drag.box.modelId,
    world.x - drag.offset.x,
    view === "front" ? drag.box.y : world.y - drag.offset.y,
    others,
    CATALOG,
    {
      id: drag.box.id,
      rotated: drag.box.rotated,
      snapDistance: 65,
      maxDistance: 180,
      ...(view === "top" ? {} : { z: elevation }),
    },
  );
  if (
    (!candidate || !inspectLayout([...others, candidate], CATALOG).valid) &&
    support
  ) {
    const [w, d] = getDimensions(drag.box, CATALOG),
      [sw, sd] = getDimensions(support, CATALOG);
    const x = Math.max(
      support.x,
      Math.min(world.x - w / 2, support.x + sw - w),
    );
    const y = Math.max(
      support.y,
      Math.min(world.y - d / 2, support.y + sd - d),
    );
    candidate = resolveDrop(drag.box.modelId, x, y, others, CATALOG, {
      id: drag.box.id,
      rotated: drag.box.rotated,
      z: elevation,
      snapDistance: 65,
      maxDistance: 180,
    });
  }
  drag.candidate =
    candidate &&
    inspectLayout([...others, candidate], CATALOG).valid &&
    validateWorkspace([...others, candidate], CATALOG).valid
      ? cleanBox(candidate)
      : null;
  $("#scene .placement-preview")?.remove();
  const preview = drag.candidate || {
    ...drag.box,
    x: world.x - drag.offset.x,
    y: view === "front" ? drag.box.y : world.y - drag.offset.y,
    z: elevation,
  };
  $("#scene svg").insertAdjacentHTML(
    "beforeend",
    renderPlacementPreview(preview, CATALOG, drag.transform, {
      valid: !!drag.candidate,
    }),
  );
  $("#fit-indicator").textContent = drag.candidate
    ? `Release to place · base ${length(drag.candidate.z)} ${units}`
    : "Stay in the work area, near the other cases";
  const ghost = $("#drag-ghost");
  ghost.style.display = "block";
  ghost.style.left = `${event.clientX + 15}px`;
  ghost.style.top = `${event.clientY + 15}px`;
  ghost.textContent = `${modelFor(drag.box).label} · ${drag.candidate ? "✓ Supported" : "Move to a clear surface"}`;
});
function endDrag(cancel = false) {
  if (!drag) return;
  const finished = drag;
  drag = null;
  $("#scene").classList.remove("dragging");
  $("#drag-ghost").style.display = "none";
  if (!cancel && finished.moved) {
    if (finished.candidate)
      commit(
        boxes.map((box) =>
          box.id === finished.box.id ? finished.candidate : box,
        ),
        "Case moved.",
      );
    else {
      notify(
        "Use a clear, supported spot in the work area, within 600 mm of the setup. The case stayed in place.",
      );
      render();
    }
  } else render();
}
$("#scene").addEventListener("pointerup", () => endDrag());
$("#scene").addEventListener("pointercancel", () => endDrag(true));
$("#catalog-list").addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-model]");
  if (!card) return;
  event.dataTransfer.setData("application/x-zarges-model", card.dataset.model);
  event.dataTransfer.effectAllowed = "copy";
});
$("#scene").addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
$("#scene").addEventListener("drop", (event) => {
  event.preventDefault();
  const modelId = event.dataTransfer.getData("application/x-zarges-model");
  if (!CATALOG.some((model) => model.id === modelId)) return;
  const point = svgPoint(event),
    transform = getSceneTransform(boxes, CATALOG, view, {
      humanScale,
      soccerScale,
    });
  const hit = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-box-id]"),
    support = hit && boxes.find((box) => box.id === hit.dataset.boxId),
    model = CATALOG.find((item) => item.id === modelId);
  const elevation = support
    ? support.z + getDimensions(support, CATALOG)[2]
    : 0;
  const world = transform.unproject(point.x, point.y, elevation);
  // Try both orientations on a surface. Prefer the orientation occupying less
  // of its long edge, leaving space for the second half of a mixed-size stack.
  const rotations =
    support && getDimensions(support, CATALOG)[1] >= model.external[0]
      ? [true, false]
      : [false, true];
  let candidate = null;
  for (const rotated of rotations) {
    const [w, d] = rotated
      ? [model.external[1], model.external[0]]
      : model.external;
    candidate = resolveDrop(
      modelId,
      world.x - w / 2,
      view === "front" && support ? support.y : world.y - d / 2,
      boxes,
      CATALOG,
      {
        id: `case-${crypto.randomUUID()}`,
        rotated,
        z: elevation,
        snapDistance: 100,
        maxDistance: 250,
      },
    );
    if (candidate && validateWorkspace([...boxes, candidate], CATALOG).valid)
      break;
    candidate = null;
  }
  if (candidate) addCase(modelId, candidate);
  else
    notify(
      "Drop inside the work area, near the setup, on a large enough surface. Use + for a nearby floor spot.",
    );
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.closest(
      "input,textarea,select,[contenteditable]:not([contenteditable='false'])",
    ) ||
    $("#dialog").open
  )
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  // Leave browser shortcuts such as Cmd/Ctrl+R, C, V, and arrow navigation
  // alone. Native copy/paste events handle the case clipboard separately.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const node = event.target.closest("[data-box-id]");
  if (node && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    selectedId = node.dataset.boxId;
    renderSelection();
    drawScene();
    $(`#scene [data-box-id="${selectedId}"]`).focus();
    return;
  }
  if (!selectedId) return;
  if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    actions.rotate();
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    actions.remove();
  }
  const offsets = {
    ArrowLeft: [-10, 0],
    ArrowRight: [10, 0],
    ArrowUp: [0, -10],
    ArrowDown: [0, 10],
  };
  if (offsets[event.key]) {
    event.preventDefault();
    const [x, y] = offsets[event.key];
    mutateSelected((box) => ({ ...box, x: box.x + x, y: box.y + y }));
  }
  if (event.key === "Escape") {
    selectedId = null;
    render();
  }
});
const ghost = document.createElement("div");
ghost.id = "drag-ghost";
ghost.className = "drag-ghost";
document.body.append(ghost);
renderCatalog();
render();
persist();
if (startupMessage) notify(startupMessage);
