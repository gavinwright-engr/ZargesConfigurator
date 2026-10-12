# Product data and what “fits” means

The catalog contains the six standard K 470 models identified from the reference image. The image supplies capacities and an arrangement, rather than readable product numbers; model identification follows the manufacturer's catalog. Data was checked against official ZARGES pages on **12 October 2026**. All dimensions below are **length × width × height in millimetres**. Weights refer to empty cases; capacities are the manufacturer's nominal litre values.

## Catalog

| Model | Capacity | Maximum outside dimensions | Inside dimensions | Empty weight |
| --- | ---: | --- | --- | ---: |
| [40810](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40810) | 29 L | 600 × 400 × 180 | 550 × 350 × 150 | 4.2 kg |
| [40568](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40568) | 42 L | 600 × 400 × 250 | 550 × 350 × 220 | 4.8 kg |
| [40678](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40678) | 60 L | 600 × 400 × 340 | 550 × 350 × 310 | 5.0 kg |
| [40564](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40564) | 73 L | 600 × 400 × 410 | 550 × 350 × 380 | 5.3 kg |
| [40847](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40847) | 60 L, long | 1200 × 400 × 180 | 1150 × 350 × 150 | 7.5 kg |
| [40565](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40565) | 157 L | 800 × 600 × 410 | 750 × 550 × 380 | 10.0 kg |

The [official 40678 product page](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40678) includes a variants table confirming the four 600 × 400 mm models. The [official 40837 variants table](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40837) confirms the 40847 and 40565 rows, including their weights. Links sometimes redirect according to locale; equivalent regional K 470 pages also expose the variants table.

Catalog data lives in [`src/catalog.js`](../src/catalog.js). No live scraping, product photography, checkout, prices, or availability feed is required to run the planner.

## Why the two reference stacks line up

These are calculations using the published maximum envelopes, rather than measured stacking interfaces.

**Stack 1:** two 73 L cases sit side by side, giving a combined 1200 × 400 mm footprint at a common height of 410 mm. The 60 L long case has the same 1200 × 400 mm envelope and spans both cases. Adding its 180 mm height gives a conservative nominal stack height of **590 mm**, **206 L** of capacity, and **18.1 kg** empty weight.

**Stack 2:** the 157 L base occupies 800 × 600 mm. Rotate both middle cases by 90° so each occupies 400 × 600 mm: the 73 L and standard 60 L fit side by side. Above the 73 L case, the 29 L case completes a 410 + 180 = 590 mm column. Above the 60 L case, the 42 L case completes a 340 + 250 = 590 mm column. Both columns therefore finish at **1000 mm** including the 410 mm base. This stack provides **361 L** and weighs **29.3 kg** empty.

The complete reference plan contains **8 cases**, **567 L**, and **47.4 kg** empty weight:

| Model | Quantity |
| --- | ---: |
| 40810 / 29 L | 1 |
| 40568 / 42 L | 1 |
| 40678 / 60 L | 1 |
| 40564 / 73 L | 3 |
| 40847 / 60 L long | 1 |
| 40565 / 157 L | 1 |

## Geometric support and mechanical stacking are different

ZARGES describes cast aluminium stacking corners across the K 470 range. Its [US 40810 product page](https://zargesusa.com/products/k470-40810) explicitly groups 40810, 40568, 40678, and 40564 as sharing a footprint and stacking together. That supports the same-footprint pairs used at the top of Stack 2.

We did **not** find an official statement confirming corner engagement for either the long 40847 bridging two 40564 cases or the two rotated smaller cases on a 40565. These combinations have matching maximum rectangular envelopes, which is sufficient to visualize and plan their footprint. It is insufficient to claim a mechanical lock, a tested load path, or a transport rating. The app treats these mixed combinations as geometric fits requiring confirmation.

The geometry model treats each closed case as an axis-aligned rectangular envelope. It can detect overlap, overhang, and insufficient same-height support. It does not model the exact lid, feet, corner casting profiles, seams, handle movement, or load-bearing contact points. Touching envelopes and full rectangular support are planning results, not physical test results.

Stack heights add the published maximum case heights. Actual engaged corners may reduce the total height; the app does not subtract an unverified engagement depth. Cargo weight, centre of gravity, acceleration, restraint, floor strength, lids bending across a seam, and allowable stack loads are outside the model. The manufacturer's dangerous-goods gross-weight figure is **not** a stacking load and is deliberately not used as one.

Before buying specifically for a mixed stack, ask ZARGES to confirm the model numbers, orientation, corner engagement, loaded application, and actual assembled dimensions. This is the outstanding product question the prototype makes easier to communicate.

## Why US retail dimensions are not mixed into this catalog

The current official regional sources disagree. For example, [ZARGES USA's 40810 page](https://zargesusa.com/products/k470-40810) lists external dimensions of 22.95 × 15.28 × 6.96 inches (about 583 × 388 × 177 mm), while the European maximum outside dimensions are 600 × 400 × 180 mm. The [US 40847 page](https://zargesusa.com/products/k470-40847) lists an external length of 45.28 inches (about 1150 mm), while the European maximum is 1200 mm. It also currently lists a clearance length larger than its external length, so those fields should not be silently treated as interchangeable measurements.

The regional 40847 empty weights also differ: the European table gives 7.5 kg, whereas the US page gives 19.2 lb (about 8.7 kg). We cannot establish from these pages whether these differences reflect measuring conventions, regional products, or catalog errors.

The planner therefore uses **one explicit convention: the European maximum outside dimensions and European weights**. Imperial display, where offered, converts those same metric figures; it does not switch to the US retail values. This makes calculations internally consistent without resolving the underlying manufacturer discrepancy. For a tightly constrained vehicle or purchase, request the applicable drawings and actual measurements from ZARGES.

## Maintaining the catalog

1. Confirm the exact standard model and regional variant with the manufacturer.
2. Record outside maximum and inside dimensions separately, in millimetres, with a direct official source.
3. Preserve the distinction between nominal capacity and a computed internal volume.
4. Use the geometry suite to verify existing arrangements whenever dimensions change.
5. Introduce a separate, sourced compatibility rule only after mechanical engagement is confirmed; do not infer that rule solely from a matching bounding rectangle.

The rendered cases are original procedural illustrations. Product names and trademarks identify the equipment; this is an independent proposal for ZARGES, not an official configurator.
