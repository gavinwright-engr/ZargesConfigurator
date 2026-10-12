/**
 * The six K 470 models in the reference arrangement.
 *
 * Dimensions are [length, width, height] in millimetres; weight is empty kg.
 * Use one dimensional convention throughout: ZARGES Europe's published
 * maximum outside dimensions. US retail pages use different figures.
 * See docs/product-data.md before changing these values or adding models.
 */
const productUrl = (id) =>
  `https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-${id}`;

export const CATALOG = [
  {
    id: "40810",
    name: "K 470",
    label: "29 L",
    volume: 29,
    external: [600, 400, 180],
    internal: [550, 350, 150],
    weight: 4.2,
    url: productUrl("40810"),
  },
  {
    id: "40568",
    name: "K 470",
    label: "42 L",
    volume: 42,
    external: [600, 400, 250],
    internal: [550, 350, 220],
    weight: 4.8,
    url: productUrl("40568"),
  },
  {
    id: "40678",
    name: "K 470",
    label: "60 L",
    volume: 60,
    external: [600, 400, 340],
    internal: [550, 350, 310],
    weight: 5,
    url: productUrl("40678"),
  },
  {
    id: "40564",
    name: "K 470",
    label: "73 L",
    volume: 73,
    external: [600, 400, 410],
    internal: [550, 350, 380],
    weight: 5.3,
    url: productUrl("40564"),
  },
  {
    id: "40847",
    name: "K 470",
    label: "60 L long",
    volume: 60,
    external: [1200, 400, 180],
    internal: [1150, 350, 150],
    weight: 7.5,
    url: productUrl("40847"),
  },
  {
    id: "40565",
    name: "K 470",
    label: "157 L",
    volume: 157,
    external: [800, 600, 410],
    internal: [750, 550, 380],
    weight: 10,
    url: productUrl("40565"),
  },
];

/**
 * Two stacks matching the supplied reference image, in millimetres.
 * x/y locate the footprint's minimum corner; z is the base elevation.
 * Rotation exchanges length and width while preserving vertical height.
 * Mixed footprints fit the published envelopes; their mechanical corner
 * engagement has not been verified. The planner reports that distinction.
 */
export const PRESET = [
  { id: "case-1", modelId: "40564", x: 0, y: 0, z: 0, rotated: false },
  { id: "case-2", modelId: "40564", x: 600, y: 0, z: 0, rotated: false },
  { id: "case-3", modelId: "40847", x: 0, y: 0, z: 410, rotated: false },
  { id: "case-4", modelId: "40565", x: 1550, y: 0, z: 0, rotated: false },
  { id: "case-5", modelId: "40564", x: 1550, y: 0, z: 410, rotated: true },
  { id: "case-6", modelId: "40678", x: 1950, y: 0, z: 410, rotated: true },
  { id: "case-7", modelId: "40810", x: 1550, y: 0, z: 820, rotated: true },
  { id: "case-8", modelId: "40568", x: 1950, y: 0, z: 750, rotated: true },
];
