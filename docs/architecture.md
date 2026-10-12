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

Cases can touch at their boundaries. A positive intersection in all three axes is a collision. Ground-level cases are supported by an unlimited floor plane; the engine imposes no vehicle or room boundary.

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

### Browser and plan modules

`src/app.js` owns the event handlers and a small undo/redo history. Every state
change validates the whole layout and the versioned plan contract before commit.
`src/renderer.js` draws original procedural SVG; its `getSceneTransform` provides
matching forward/inverse projection for pointer movement. `renderPlacementPreview`
uses a fixed transform during drags so auto-fit does not move the target under the
pointer. The renderer supports perspective, front, and top views plus metric or
converted inch dimension labels.

The main workspace has a fixed responsive height. The catalog and inspector
scroll separately, so clicking a case cannot stretch the canvas or change the
screen projection. Both `renderScene` and `getSceneTransform` take `humanScale`
(default `true`); controller pointer operations pass the same value. The scale
figure is exactly 1828.8 mm (6 ft) tall and does not participate in collision,
support, capacity, mass, or order quantities. Thumbnail rendering omits it.

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
unsupported or out-of-bounds plan cannot be exported accidentally. No account,
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
