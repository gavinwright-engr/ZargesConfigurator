# Architecture and integration

The planner is a static browser application written as small JavaScript ES modules. Product data, rectangular geometry, rendering, and interface state are separated so a host website can adopt the useful parts independently. No application server, framework, database, package install, or external rendering service is required.

## Data contract

[`src/catalog.js`](../src/catalog.js) exports `CATALOG` and `PRESET`. Each catalog record has this shape:

```js
{
  id: '40564',                     // Manufacturer model identifier, kept as text.
  name: 'K 470',
  label: '73 L',
  volume: 73,                     // Nominal litres, not recomputed from dimensions.
  external: [600, 400, 410],       // Maximum envelope: length, width, height in mm.
  internal: [550, 350, 380],
  weight: 5.3,                    // Empty kilograms.
  url: 'https://www.zarges.com/…', // Official specification source.
}
```

A placed case references that catalog instead of copying its product dimensions:

```js
{
  id: 'case-1',       // Unique instance identifier; multiple cases can share a model.
  modelId: '40564',
  x: 0, y: 0, z: 0, // Minimum footprint corner and base elevation, all in mm.
  rotated: false,     // true swaps external length and width, preserving height.
}
```

The horizontal floor is the `x/y` plane; positive `z` points upward. Display units do not change these stored metric coordinates. Clone `PRESET` before making edits so resetting restores the original reference arrangement.

The distinction between maximum envelopes and actual stacking interfaces is intentional. Read [product data](product-data.md) before changing dimensions, interpreting placement validity, or introducing compatibility claims.

## Geometry API

[`src/stacking.js`](../src/stacking.js) has no DOM dependency. It can run in a browser, Node, a host application's state layer, or a worker.

| Export | Purpose |
| --- | --- |
| `getDimensions(box, catalog)` | Return `[length, width, height]` after the instance's quarter turn. |
| `validatePlacement(box, others, catalog)` | Check one candidate for collisions, negative elevation, and full same-height rectangular support. |
| `resolveDrop(modelId, x, y, others, catalog, options)` | Snap a proposed placement to nearby edges and supported elevations; return a candidate with its placement report or `null`. |
| `inspectLayout(boxes, catalog)` | Validate every case, find duplicate instance IDs, and aggregate bounds, capacity, weight, and case count. |

Placement reports include `valid`, `code`, `reason`, `supportRatio`, `supportedBy`, and `issues`. “Valid” means the rectangular geometry passes the model. It does not mean verified corner engagement or a rated loaded stack.

### Collision and support rules

Cases can touch at their boundaries. A positive intersection in all three axes is a collision. The reusable geometry engine has an unlimited floor plane. The application additionally calls `validateWorkspace` for its bounded planning area.

An elevated case must have its complete rectangular footprint covered by surfaces at exactly its base height. A sweep across clipped support rectangles computes their union area. This avoids counting the same area twice and permits a long case to bridge two equal-height envelopes. Supports at different heights do not combine into one supported surface.

The numeric tolerance is only for floating-point arithmetic. It does not represent an allowed physical gap or overhang. The engine does not model material deformation, case corners, centre of gravity, cargo, restraint, or structural loading.

### Resolve a drop, then validate the whole proposal

This example can run in a module loaded from the repository root:

```js
import { CATALOG, PRESET } from './src/catalog.js';
import { inspectLayout, resolveDrop } from './src/stacking.js';

const boxes = structuredClone(PRESET);
const moving = boxes.find((box) => box.id === 'case-7');
const candidate = resolveDrop(
  moving.modelId,
  1558, 4,                         // Approximate pointer position in world mm.
  boxes,
  CATALOG,
  { id: moving.id, rotated: true }, // Ignore this instance's existing position.
);

if (candidate) {
  const { placement, ...nextBox } = candidate;
  const proposed = boxes.map((box) => box.id === moving.id ? nextBox : box);
  const report = inspectLayout(proposed, CATALOG);
  if (report.valid) {
    // Commit `proposed` to host application state and rerender.
  }
}
```

Always inspect the entire proposed layout after moving, rotating, or removing a supporting case. A candidate can pass its own placement test while leaving a case above it unsupported. A UI should commit only an acceptable whole-layout result, or display those dependent errors explicitly.

`resolveDrop` accepts `id`, `rotated`, optional exact `z`, `snapDistance`, and `maxDistance`. Omitting `z` searches the floor and other case tops. Supplying `z` limits the search to that elevation for precision controls. Snapping first looks near the pointer; a wider recovery search runs if the first search finds no valid result. It never approves an overlapping or partially supported candidate solely because it is close to the pointer.

## Host integration

### Workspace and clipboard modules

`src/workspace.js` exports `WORKSPACE`, `validateWorkspace`, `findFloorPlacement`,
and `repairWorkspace`. The app limits full case envelopes to 4,500 × 2,400 mm,
below 3,000 mm high. Footprints must form a connected group with edge-to-edge
gaps no greater than 600 mm. These constants are interface choices, separate
from manufacturer dimensions and reusable collision/support geometry.

The fixed floor depth runs from **y = -900 to 1500 mm**. The reference setup
occupies y = 0 to 600 mm, so the remaining 1800 mm is split equally in front
and behind it. Negative y is valid floor space in front of the original cases;
z stays nonnegative. Existing case coordinates and stack heights are unchanged.
The floor does not follow a dragged case or expand to accommodate it. Grid lines
remain on 200 mm world coordinates, with equal partial cells at the depth edges.

All additions, rotations, nudges, imports, and drag commits pass workspace
validation. `findFloorPlacement` searches nearby rectangle edges in both depth
directions, preserves orientation, and returns `null` when no valid spot fits.
It prefers the existing row instead of the front edge of the floor; the first
case starts at y = 0, adjusted only if its depth requires more room.
It never extends the stage to accommodate a distant case.

When opening older unbounded sessions, `repairWorkspace` keeps the main valid
group and relocates distant cases without changing model counts or rotations.
The original JSON is backed up in localStorage under
`zarges-stack-planner:v1:before-workspace-limits`. If the complete plan cannot
fit, the stored original remains intact and the app displays the reference
setup. A later edit replaces the active saved session; the backup remains.

`src/clipboard.js` defines a versioned plain-text case descriptor containing
only a known model ID and a boolean rotation. Native copy/paste events support
Ctrl/Cmd+C and Ctrl/Cmd+V without clipboard permission prompts. Buttons use the
browser clipboard API and retain a per-tab fallback if access is denied.
Pasting generates a fresh instance ID and uses the same bounded floor search
as adding a case. Editable fields, selected page text, and dialogs keep normal
text copy/paste behavior. Unrelated clipboard text cannot mutate the layout.

### Browser and plan modules

`src/app.js` owns the event handlers and a small undo/redo history. Every state
change validates the whole layout and the versioned plan contract before commit.
`src/renderer.js` draws original procedural SVG; its `getSceneTransform` provides
matching forward/inverse projection for pointer movement. `renderPlacementPreview`
uses a fixed transform during drags so auto-fit does not move the target under the
pointer. The renderer supports perspective, front, and top views plus metric or
converted inch dimension labels.

The camera fits the cases and any enabled scale references. Empty floor never
enters the fit bounds: its fixed 4.5 × 2.4 m boundary is cropped by the canvas
when needed, while placement validation still enforces the full work area.
Hiding the person and ball therefore gives a close view of the cases.
The main workspace has a fixed responsive height. The catalog and inspector
scroll separately, so clicking a case cannot stretch the canvas or change the
screen projection. Both `renderScene` and `getSceneTransform` take `humanScale`
(default `true`); controller pointer operations pass the same value. The scale
figure is exactly 1828.8 mm (6 ft) tall. The independent `soccerScale` option
(default `false`) draws a 220 mm diameter soccer ball. Neither reference affects
collision, support, capacity, mass, or order quantities. Thumbnails omit them.
`workspace: false` omits the bounded floor for isolated product illustrations.
Case panels, hardware, and labels remain inside their maximum envelopes;
the selection highlight is the only intentional outline outside a case.
Selection is a final SVG overlay with pointer events disabled. It traces the
selected envelope and, in 3D, all three visible face seams. Neighboring cases
cannot paint over its edges, and it does not change artwork order, hit targets,
or camera bounds.

The catalog includes the complete 25-size standard European K 470 Universal Box
range. The six reference models are marked `reference: true`; that flag changes
catalog filtering only, never which models can be placed or imported.

`src/plans.js` defines the portable document:

```json
{"version":1,"units":"mm","boxes":[]}
```

JSON files, URL hashes, and localStorage all pass through `parsePlan`. It accepts
at most 60 cases, unique safe ASCII instance IDs, official catalog model IDs,
boolean rotations, and finite coordinates within ±50,000 mm. Unknown properties
are discarded. Collision/support checks then validate the complete layout. The
stored format contains no user-supplied HTML, labels, URLs, or executable content.
Share links contain standard base64-encoded JSON in `#plan=`; they use the same
validation as imports. The URL fragment is not sent to the hosting server.

`boxListCsv` aggregates quantities from validated instances and obtains every
text field from the trusted catalog. `makePlan` validates before saving, so an
unsupported or schema-invalid plan cannot be exported accidentally. The controller
separately enforces the tighter interactive workspace bounds. No account,
backend storage, or external service is involved.

### Adopting the geometry

For an existing product website, start by importing only the catalog and geometry modules. Map the host's product records to the catalog contract, use its existing controls to produce placed-case instances, and call `inspectLayout` before accepting layout changes. The UI and renderer are optional presentation layers.

Keep manufacturer model identifiers and per-instance identifiers separate. Keep dimensions in millimetres internally and convert only when formatting display values. Persist plain layout data instead of DOM nodes or renderer objects. Treat imported layouts as untrusted data: check their schema, known model IDs, finite coordinates, unique instance IDs, and whole-layout geometry before accepting them.

Changing catalog dimensions can change the validity of saved plans. A production integration should version the product dataset, migrate or revalidate saved layouts, and obtain manufacturer-approved compatibility rules and drawings before claiming mechanical engagement.

There is no direct cart submission in this proposal. A production commerce integration can map the aggregated model quantities to its own product variants after the user reviews the list. Price and availability should come from that host's current catalog rather than being copied into geometry code.

## Development and static hosting

- `npm run dev` starts the small local HTTP server on port 3000. Set `PORT` to change it.
- `npm test` uses Node's built-in test runner for the geometry suite.
- `npm run build` copies the browser files into `dist/`; it does not compile or bundle them.
- Serve `dist/` with any static HTTP host. ES modules should be served over HTTP, rather than opening `index.html` directly with a `file:` URL.

The local server is for development. Static hosting handles production TLS, caching, and headers. The geometry tests focus on behavior that matters: the reference arrangement, rotated footprints, supported bridges, overlaps, gaps, partial support, and changes that orphan other cases.
